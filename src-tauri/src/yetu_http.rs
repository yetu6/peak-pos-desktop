//! Yetu requests sent from the till's native side (F-255, 2026-10-20).
//!
//! From the web view an add took 0.8–1.6 s on Bahari's Linux till though Yetu
//! answered in under 0.1 s: the web view asked permission (a CORS preflight)
//! before the first request to every new address, and WebKitGTK opened a new
//! TLS connection for every change. One client kept for the whole run reuses
//! its connections, and a native request needs no preflight, so a change costs
//! one round trip.
//!
//! The native side has none of the web view's limits, so it holds its own: only
//! the till's configured Yetu (the address typed on first boot, else the one
//! built in), only Yetu's methods, only the headers the till sends, and no
//! redirects.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

/// How long an idle connection is kept for the next request.
pub const IDLE_KEPT: Duration = Duration::from_secs(90);
/// The longest a request may take before the till stops waiting.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Where the web view looks when nothing is configured (src/lib/peakConfig.ts).
const DEVELOPMENT_YETU: &str = "http://localhost:8080";

const METHODS: [&str; 5] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
/// The headers the till sends Yetu, and no others. A new one goes here too
/// (src/lib/yetuFetch.test.ts reads this list against the till's code).
const ALLOWED_HEADERS: [&str; 7] = [
    "accept", "authorization", "content-type", "idempotency-key", "x-peak-pairing-token",
    "x-peak-tenant-id", "x-peak-tenant-user-id",
];

pub struct YetuHttp(reqwest::Client);

impl YetuHttp {
    pub fn new() -> Result<Self, String> {
        reqwest::Client::builder()
            .pool_idle_timeout(IDLE_KEPT)
            .tcp_keepalive(Duration::from_secs(30))
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(concat!("Yetu-Till/", env!("CARGO_PKG_VERSION")))
            .build()
            .map(Self)
            .map_err(|error| error.to_string())
    }
}

#[derive(Debug, Deserialize)]
pub struct YetuRequest {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct YetuAnswer {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

/// HTTPS, or plain HTTP to this computer while developing: the rule the
/// address screen holds (validatePeakApiUrl).
fn acceptable(raw: &str) -> Option<reqwest::Url> {
    let url = reqwest::Url::parse(raw.trim()).ok()?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    match url.scheme() {
        "https" => Some(url),
        "http" if local => Some(url),
        _ => None,
    }
}

/// The till's Yetu, found the way the web view finds it (getApiBaseUrl).
fn resolve_yetu(configured: Option<String>, built_in: Option<&str>) -> reqwest::Url {
    configured
        .as_deref()
        .and_then(acceptable)
        .or_else(|| built_in.and_then(acceptable))
        .unwrap_or_else(|| reqwest::Url::parse(DEVELOPMENT_YETU).expect("a valid address"))
}

fn yetu_of(app: &AppHandle) -> reqwest::Url {
    let configured = crate::identity::load_peak_config(app.clone()).ok().flatten();
    resolve_yetu(configured, option_env!("VITE_PEAK_API_URL"))
}

fn check(request: &YetuRequest, yetu: &reqwest::Url) -> Result<(reqwest::Url, reqwest::Method), String> {
    let url = acceptable(&request.url)
        .filter(|url| url.origin() == yetu.origin())
        .ok_or_else(|| format!("refused: {} is not this till's Yetu", request.url))?;
    let method = request.method.to_uppercase();
    if !METHODS.contains(&method.as_str()) {
        return Err(format!("refused: {method} is not a method Yetu uses"));
    }
    for (name, _) in &request.headers {
        if !ALLOWED_HEADERS.contains(&name.to_ascii_lowercase().as_str()) {
            return Err(format!("refused: the till does not send {name}"));
        }
    }
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|error| error.to_string())?;
    Ok((url, method))
}

pub async fn send(http: &YetuHttp, yetu: &reqwest::Url, request: YetuRequest) -> Result<YetuAnswer, String> {
    let (url, method) = check(&request, yetu)?;
    let mut builder = http.0.request(method, url);
    for (name, value) in request.headers {
        builder = builder.header(name, value);
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }
    let response = builder.send().await.map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| Some((name.to_string(), value.to_str().ok()?.to_string())))
        .collect();
    let body = response.text().await.map_err(|error| error.to_string())?;
    Ok(YetuAnswer { status, headers, body })
}

#[tauri::command]
pub async fn yetu_request(
    app: AppHandle,
    http: State<'_, YetuHttp>,
    request: YetuRequest,
) -> Result<YetuAnswer, String> {
    send(&http, &yetu_of(&app), request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    #[derive(Debug, Clone)]
    struct Seen {
        method: String,
        path: String,
        headers: Vec<String>,
        body: String,
    }

    struct StandIn {
        address: String,
        connections: Arc<AtomicUsize>,
        seen: Arc<Mutex<Vec<Seen>>>,
    }

    impl StandIn {
        fn yetu(&self) -> reqwest::Url {
            reqwest::Url::parse(&self.address).unwrap()
        }
    }

    /// A Yetu stand-in on this computer: answers every request on a
    /// connection it keeps open, counts the connections it accepted, and
    /// sends /moved somewhere else.
    fn yetu_on_this_computer() -> StandIn {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let connections = Arc::new(AtomicUsize::new(0));
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (counted, kept) = (connections.clone(), seen.clone());
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { return };
                counted.fetch_add(1, Ordering::SeqCst);
                let kept = kept.clone();
                std::thread::spawn(move || {
                    let mut reader = BufReader::new(stream.try_clone().unwrap());
                    let mut writer = stream;
                    loop {
                        let mut line = String::new();
                        if reader.read_line(&mut line).unwrap_or(0) == 0 {
                            return;
                        }
                        let mut parts = line.split_whitespace();
                        let method = parts.next().unwrap_or("").to_string();
                        let path = parts.next().unwrap_or("").to_string();
                        let mut headers = Vec::new();
                        let mut length = 0usize;
                        loop {
                            let mut header = String::new();
                            reader.read_line(&mut header).unwrap();
                            let header = header.trim_end().to_lowercase();
                            if header.is_empty() {
                                break;
                            }
                            if let Some(value) = header.strip_prefix("content-length:") {
                                length = value.trim().parse().unwrap();
                            }
                            headers.push(header);
                        }
                        let mut body = vec![0; length];
                        reader.read_exact(&mut body).unwrap();
                        let body = String::from_utf8(body).unwrap();
                        let answer = format!("{{\"echo\":{}}}", if body.is_empty() { "null".into() } else { body.clone() });
                        let moved = path == "/moved";
                        kept.lock().unwrap().push(Seen { method, path, headers, body });
                        if moved {
                            write!(writer, "HTTP/1.1 302 Found\r\nLocation: /elsewhere\r\nContent-Length: 0\r\n\r\n").unwrap();
                        } else {
                            write!(
                                writer,
                                "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nX-Request-ID: r-1\r\nContent-Length: {}\r\n\r\n{}",
                                answer.len(),
                                answer
                            )
                            .unwrap();
                        }
                    }
                });
            }
        });
        StandIn { address, connections, seen }
    }

    fn post(url: String, body: &str) -> YetuRequest {
        YetuRequest {
            method: "POST".into(),
            url,
            headers: vec![
                ("Content-Type".into(), "application/json".into()),
                ("Idempotency-Key".into(), "add-1".into()),
            ],
            body: Some(body.into()),
        }
    }

    fn get(url: String) -> YetuRequest {
        YetuRequest { method: "GET".into(), url, headers: vec![], body: None }
    }

    #[test]
    fn a_change_goes_as_asked_and_comes_back_whole() {
        let yetu = yetu_on_this_computer();
        let http = YetuHttp::new().unwrap();
        let answer = tauri::async_runtime::block_on(send(
            &http,
            &yetu.yetu(),
            post(format!("{}/api/v1/pos/orders/o-1/items", yetu.address), r#"{"quantity":1}"#),
        ))
        .unwrap();

        assert_eq!(answer.status, 201);
        assert_eq!(answer.body, r#"{"echo":{"quantity":1}}"#);
        assert!(answer.headers.contains(&("x-request-id".into(), "r-1".into())));
        assert!(answer.headers.contains(&("content-type".into(), "application/json".into())));
        let seen = yetu.seen.lock().unwrap();
        assert_eq!(seen[0].method, "POST");
        assert_eq!(seen[0].path, "/api/v1/pos/orders/o-1/items");
        assert_eq!(seen[0].body, r#"{"quantity":1}"#);
        assert!(seen[0].headers.contains(&"idempotency-key: add-1".into()));
        assert!(seen[0].headers.iter().any(|h| h.starts_with("user-agent: yetu-till/")));
    }

    // The point of F-255: a second change reuses the first one's connection.
    #[test]
    fn changes_one_after_another_share_one_connection() {
        let yetu = yetu_on_this_computer();
        let http = YetuHttp::new().unwrap();
        tauri::async_runtime::block_on(async {
            for n in 0..3 {
                send(&http, &yetu.yetu(), post(format!("{}/api/v1/pos/orders", yetu.address), &format!("{{\"n\":{n}}}")))
                    .await
                    .unwrap();
            }
            let mut lookup = get(format!("{}/api/v1/pos/catalog", yetu.address));
            lookup.method = "get".into();
            send(&http, &yetu.yetu(), lookup).await.unwrap();
        });
        assert_eq!(yetu.seen.lock().unwrap().len(), 4);
        assert_eq!(yetu.seen.lock().unwrap()[3].method, "GET");
        assert_eq!(yetu.connections.load(Ordering::SeqCst), 1, "each request opened its own connection");
    }

    #[test]
    fn a_redirect_comes_back_as_it_is_and_is_not_followed() {
        let yetu = yetu_on_this_computer();
        let http = YetuHttp::new().unwrap();
        let answer =
            tauri::async_runtime::block_on(send(&http, &yetu.yetu(), get(format!("{}/moved", yetu.address)))).unwrap();
        assert_eq!(answer.status, 302);
        assert_eq!(yetu.seen.lock().unwrap().len(), 1, "the redirect was followed");
    }

    #[test]
    fn only_this_tills_yetu() {
        let yetu = reqwest::Url::parse("https://api.yetu.fbcsoftwares.com").unwrap();
        for allowed in [
            "https://api.yetu.fbcsoftwares.com/api/v1/pos/orders",
            "https://api.yetu.fbcsoftwares.com:443/health/ready",
        ] {
            assert!(check(&get(allowed.into()), &yetu).is_ok(), "{allowed} was refused");
        }
        for refused in [
            "https://elsewhere.example.com/api/v1/pos/orders",
            "https://api.yetu.fbcsoftwares.com.evil.example/api/v1/pos/orders",
            "https://api.yetu.fbcsoftwares.com:8443/api/v1/pos/orders",
            "http://api.yetu.fbcsoftwares.com/api/v1/pos/orders",
            "http://localhost:8080/api/v1/pos/orders",
            "http://127.0.0.1:631/",
            "file:///etc/passwd",
            "not a url",
        ] {
            assert!(check(&get(refused.into()), &yetu).is_err(), "{refused} was allowed");
        }
    }

    #[test]
    fn only_yetus_methods_and_only_the_tills_headers() {
        let yetu = reqwest::Url::parse("https://api.yetu.fbcsoftwares.com").unwrap();
        let url = "https://api.yetu.fbcsoftwares.com/api/v1/pos/orders".to_string();
        for method in ["get", "POST", "PUT", "PATCH", "DELETE"] {
            let request = YetuRequest { method: method.into(), ..get(url.clone()) };
            assert!(check(&request, &yetu).is_ok(), "{method} was refused");
        }
        for method in ["CONNECT", "TRACE", "OPTIONS", "HEAD"] {
            let request = YetuRequest { method: method.into(), ..get(url.clone()) };
            assert!(check(&request, &yetu).is_err(), "{method} was allowed");
        }
        for header in [
            "Authorization", "Content-Type", "Idempotency-Key", "X-Peak-Pairing-Token", "Accept",
            "X-Peak-Tenant-Id", "x-peak-tenant-user-id",
        ] {
            let request = YetuRequest { headers: vec![(header.into(), "v".into())], ..get(url.clone()) };
            assert!(check(&request, &yetu).is_ok(), "{header} was refused");
        }
        for header in [
            "Host", "cookie", "Origin", "Transfer-Encoding", "Proxy-Authorization", "Sec-Fetch-Site",
            "X-Forwarded-For", " host", "authorization ", "",
        ] {
            let request = YetuRequest { headers: vec![(header.into(), "v".into())], ..get(url.clone()) };
            assert!(check(&request, &yetu).is_err(), "{header} was allowed");
        }
    }

    #[test]
    fn the_tills_yetu_is_found_as_the_web_view_finds_it() {
        let built_in = Some("https://api.yetu.fbcsoftwares.com");
        assert_eq!(
            resolve_yetu(Some("https://yetu.hotel.example/".into()), built_in).origin(),
            reqwest::Url::parse("https://yetu.hotel.example").unwrap().origin()
        );
        // A configured address the address screen would refuse is not used.
        assert_eq!(
            resolve_yetu(Some("http://yetu.hotel.example".into()), built_in).origin(),
            reqwest::Url::parse("https://api.yetu.fbcsoftwares.com").unwrap().origin()
        );
        assert_eq!(
            resolve_yetu(None, None).origin(),
            reqwest::Url::parse("http://localhost:8080").unwrap().origin()
        );
    }

    #[test]
    fn nothing_answering_is_an_error_not_an_answer() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        drop(listener);
        let http = YetuHttp::new().unwrap();
        let yetu = reqwest::Url::parse(&address).unwrap();
        let result = tauri::async_runtime::block_on(send(&http, &yetu, get(format!("{address}/health/ready"))));
        assert!(result.is_err());
    }
}
