use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
};

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tauri::ipc::Channel;
use tokio::sync::mpsc;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};

static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static SOCKETS: OnceLock<Mutex<HashMap<u64, mpsc::UnboundedSender<Message>>>> = OnceLock::new();

fn sockets() -> &'static Mutex<HashMap<u64, mpsc::UnboundedSender<Message>>> {
    SOCKETS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// What the till hears about its connection, on the channel it made before
/// asking to connect: "open" is said before this command returns the
/// connection's number, and an event named by that number arrived before
/// anyone could listen for it (the till sat at "connecting").
#[derive(Clone, Serialize)]
pub struct SocketEvent {
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<String>,
}

fn say(events: &Channel<SocketEvent>, kind: &'static str, data: Option<String>) {
    let _ = events.send(SocketEvent { kind, data });
}

#[tauri::command]
pub async fn open_peak_socket(
    url: String,
    authorization: String,
    origin: String,
    events: Channel<SocketEvent>,
) -> Result<u64, String> {
    let mut request = url.into_client_request().map_err(|e| e.to_string())?;
    request.headers_mut().insert(
        "Authorization",
        authorization
            .parse()
            .map_err(|_| "invalid authorization header".to_string())?,
    );
    request.headers_mut().insert(
        "Origin",
        origin
            .parse()
            .map_err(|_| "invalid origin header".to_string())?,
    );
    let (stream, _) = connect_async(request).await.map_err(|e| e.to_string())?;
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let (mut writer, mut reader) = stream.split();
    let (tx, mut rx) = mpsc::unbounded_channel();
    sockets()
        .lock()
        .map_err(|_| "socket registry unavailable".to_string())?
        .insert(id, tx);
    say(&events, "open", None);
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                outbound = rx.recv() => match outbound {
                    Some(message) => if writer.send(message).await.is_err() { break; },
                    None => break,
                },
                inbound = reader.next() => match inbound {
                    Some(Ok(Message::Text(text))) => say(&events, "message", Some(text.to_string())),
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {},
                    Some(Err(error)) => { say(&events, "error", Some(error.to_string())); break; }
                }
            }
        }
        if let Ok(mut registry) = sockets().lock() {
            registry.remove(&id);
        }
        say(&events, "close", None);
    });
    Ok(id)
}

#[tauri::command]
pub fn send_peak_socket(id: u64, data: String) -> Result<(), String> {
    let registry = sockets()
        .lock()
        .map_err(|_| "socket registry unavailable".to_string())?;
    registry
        .get(&id)
        .ok_or_else(|| "socket is closed".to_string())?
        .send(Message::Text(data.into()))
        .map_err(|_| "socket is closed".to_string())
}

#[tauri::command]
pub fn close_peak_socket(id: u64) -> Result<(), String> {
    if let Some(sender) = sockets()
        .lock()
        .map_err(|_| "socket registry unavailable".to_string())?
        .remove(&id)
    {
        let _ = sender.send(Message::Close(None));
    }
    Ok(())
}
