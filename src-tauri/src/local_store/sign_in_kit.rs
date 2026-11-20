#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::Instant;

    use argon2::{password_hash::PasswordHasher, Argon2};
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use ed25519_dalek::{Signer, SigningKey};
    use rusqlite::Connection;
    use serde_json::{json, Value};

    use super::super::{
        LocalStore, LocalStoreError, OfflinePublicKey, OfflinePublicKeyset, SignInCheck,
        TerminalBinding,
    };

    const DOMAIN: &[u8] = b"peak-pos-sign-in-kit-v1\0";
    const NOW: i64 = 1_800_000_000_000;

    fn store() -> LocalStore {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .pragma_update(None, "foreign_keys", true)
            .unwrap();
        let schema_version = super::super::migrations::migrate(&mut connection).unwrap();
        LocalStore {
            connection,
            cipher_version: "test".into(),
            schema_version,
            path: PathBuf::from(":memory:"),
            active_staff: None,
        }
    }

    fn key() -> SigningKey {
        SigningKey::from_bytes(&[7_u8; 32])
    }

    fn paired_store() -> LocalStore {
        let mut store = store();
        store
            .bind_terminal(TerminalBinding {
                terminal_id: "terminal-1".into(),
                credential_epoch: 4,
                property_id: "property-1".into(),
                outlet_id: "outlet-1".into(),
                register_id: "register-1".into(),
                trust_key_id: "server-key-1".into(),
                trust_public_key_b64: URL_SAFE_NO_PAD.encode(key().verifying_key().to_bytes()),
                configuration_payload_b64: URL_SAFE_NO_PAD.encode(b"configuration-v1"),
                revocation_generation: 2,
                paired_at_ms: NOW,
            })
            .unwrap();
        store
    }

    fn copy(pin: &str) -> String {
        Argon2::default().hash_password(pin.as_bytes()).unwrap().to_string()
    }

    fn member(id: &str, name: &str, pin: Option<&str>) -> Value {
        let mut value = json!({
            "staffId": id, "displayName": name, "needsSetup": pin.is_none(),
            "maxAttempts": 5, "baseLockoutMs": 60000, "roleCode": "POS_CASHIER",
            "permissions": ["pos.order.create"],
        });
        if let Some(pin) = pin {
            value["tillCopyPhc"] = json!(copy(pin));
            value["copyVersion"] = json!(format!("v-{pin}"));
        }
        value
    }

    fn payload(terminal: &str, issued: i64, staff: Vec<Value>) -> Vec<u8> {
        serde_json::to_vec(&json!({
            "terminalId": terminal, "issuedAtMs": issued, "staff": staff,
            "terminal": {"mode": "BAR", "prepStations": [], "propertyName": "Casanova",
                         "outletName": "Bar", "terminalName": "Main till", "capabilities": {}},
        }))
        .unwrap()
    }

    fn sign(signer: &SigningKey, payload: &[u8]) -> (String, String) {
        let mut message = DOMAIN.to_vec();
        message.extend_from_slice(payload);
        (
            URL_SAFE_NO_PAD.encode(payload),
            URL_SAFE_NO_PAD.encode(signer.sign(&message).to_bytes()),
        )
    }

    fn install(store: &mut LocalStore, issued: i64, staff: Vec<Value>) -> Result<(), LocalStoreError> {
        let (kit, signature) = sign(&key(), &payload("terminal-1", issued, staff));
        store
            .install_sign_in_kit(&kit, &signature, "server-key-1", NOW)
            .map(|_| ())
    }

    fn one_person() -> Vec<Value> {
        vec![member("staff-1", "Amina Hassan", Some("2468"))]
    }

    #[test]
    fn a_kit_with_a_bad_signature_is_refused_and_the_old_kit_stays() {
        let mut store = paired_store();
        install(&mut store, 1_000, one_person()).unwrap();

        let other = SigningKey::from_bytes(&[9_u8; 32]);
        let (kit, signature) = sign(&other, &payload("terminal-1", 2_000, vec![]));
        assert!(store
            .install_sign_in_kit(&kit, &signature, "server-key-1", NOW)
            .is_err());

        let (kit, signature) = sign(&key(), &payload("terminal-1", 3_000, vec![]));
        let mut tampered = URL_SAFE_NO_PAD.decode(&kit).unwrap();
        tampered[10] ^= 1;
        assert!(store
            .install_sign_in_kit(&URL_SAFE_NO_PAD.encode(tampered), &signature, "server-key-1", NOW)
            .is_err());

        assert!(matches!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW).unwrap(),
            SignInCheck::Ok { .. }
        ));
    }

    #[test]
    fn a_kit_for_another_terminal_is_refused() {
        let mut store = paired_store();
        let (kit, signature) = sign(&key(), &payload("terminal-2", 1_000, one_person()));
        assert!(store
            .install_sign_in_kit(&kit, &signature, "server-key-1", NOW)
            .is_err());
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW).unwrap(),
            SignInCheck::Unknown
        );
    }

    #[test]
    fn a_key_the_till_does_not_trust_is_refused() {
        let mut store = paired_store();
        let keyset = OfflinePublicKeyset {
            protocol_version: 1,
            issued_at: "2027-01-15T07:00:00Z".into(),
            keys: vec![OfflinePublicKey {
                kid: "server-key-1".into(),
                algorithm: "Ed25519".into(),
                signature_version: 1,
                state: "REVOKED".into(),
                not_before: "2027-01-01T00:00:00Z".into(),
                not_after: "2028-01-01T00:00:00Z".into(),
                public_key_b64: URL_SAFE_NO_PAD.encode(key().verifying_key().to_bytes()),
            }, OfflinePublicKey {
                kid: "server-key-2".into(),
                algorithm: "Ed25519".into(),
                signature_version: 1,
                state: "CURRENT".into(),
                not_before: "2027-01-01T00:00:00Z".into(),
                not_after: "2028-01-01T00:00:00Z".into(),
                public_key_b64: URL_SAFE_NO_PAD.encode([5_u8; 32]),
            }],
        };
        store.install_authenticated_keyset(&keyset, NOW).unwrap();
        assert!(install(&mut store, NOW - 10, one_person()).is_err());
    }

    #[test]
    fn an_older_kit_is_refused_and_a_newer_one_replaces_the_whole_kit() {
        let mut store = paired_store();
        install(&mut store, 2_000, one_person()).unwrap();
        assert!(install(&mut store, 1_000, vec![]).is_err());
        assert!(matches!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW).unwrap(),
            SignInCheck::Ok { .. }
        ));
        install(&mut store, 3_000, vec![member("staff-2", "Juma Said", Some("1357"))]).unwrap();
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW).unwrap(),
            SignInCheck::Unknown
        );
        assert!(matches!(
            store.verify_sign_in_pin("staff-2", "1357".into(), NOW).unwrap(),
            SignInCheck::Ok { .. }
        ));
    }

    #[test]
    fn a_copy_that_is_not_the_agreed_argon2id_form_refuses_the_whole_kit() {
        let mut store = paired_store();
        let mut weak = member("staff-1", "Amina Hassan", Some("2468"));
        weak["tillCopyPhc"] = json!("$argon2id$v=19$m=1024,t=1,p=1$c2FsdHNhbHRzYWx0cw$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g");
        assert!(install(&mut store, 1_000, vec![weak]).is_err());
    }

    #[test]
    fn a_correct_pin_gives_ok_with_the_person_and_the_terminal() {
        let mut store = paired_store();
        install(&mut store, 1_000, one_person()).unwrap();
        match store.verify_sign_in_pin("staff-1", "2468".into(), NOW).unwrap() {
            SignInCheck::Ok { staff, terminal } => {
                assert_eq!(staff.staff_id, "staff-1");
                assert_eq!(staff.display_name, "Amina Hassan");
                assert_eq!(staff.role_code, "POS_CASHIER");
                assert_eq!(staff.permissions, vec!["pos.order.create".to_string()]);
                assert_eq!(terminal.mode, "BAR");
                assert_eq!(terminal.property_name, "Casanova");
                assert_eq!(terminal.terminal_name, "Main till");
            }
            other => panic!("expected Ok, got {other:?}"),
        }
    }

    #[test]
    fn wrong_pins_count_down_and_the_fifth_locks_then_doubles() {
        let mut store = paired_store();
        install(&mut store, 1_000, one_person()).unwrap();
        for left in [4, 3, 2, 1] {
            assert_eq!(
                store.verify_sign_in_pin("staff-1", "0000".into(), NOW).unwrap(),
                SignInCheck::Wrong { attempts_left: left }
            );
        }
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "0000".into(), NOW).unwrap(),
            SignInCheck::Locked { until_ms: NOW + 60_000 }
        );
        // Locked means locked: even the right PIN waits.
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW + 59_999).unwrap(),
            SignInCheck::Locked { until_ms: NOW + 60_000 }
        );
        // After the wait one more wrong PIN doubles it.
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "0000".into(), NOW + 60_000).unwrap(),
            SignInCheck::Locked { until_ms: NOW + 60_000 + 120_000 }
        );
        // After that wait the right PIN is let in and the count starts again.
        assert!(matches!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW + 180_000).unwrap(),
            SignInCheck::Ok { .. }
        ));
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "0000".into(), NOW + 180_001).unwrap(),
            SignInCheck::Wrong { attempts_left: 4 }
        );
    }

    #[test]
    fn the_kits_own_limits_are_the_ones_used() {
        let mut store = paired_store();
        let mut person = member("staff-1", "Amina Hassan", Some("2468"));
        person["maxAttempts"] = json!(2);
        person["baseLockoutMs"] = json!(1000);
        install(&mut store, 1_000, vec![person]).unwrap();
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "0000".into(), NOW).unwrap(),
            SignInCheck::Wrong { attempts_left: 1 }
        );
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "0000".into(), NOW).unwrap(),
            SignInCheck::Locked { until_ms: NOW + 1_000 }
        );
    }

    #[test]
    fn a_person_absent_from_the_kit_is_unknown() {
        let mut store = paired_store();
        install(&mut store, 1_000, one_person()).unwrap();
        assert_eq!(
            store.verify_sign_in_pin("staff-9", "2468".into(), NOW).unwrap(),
            SignInCheck::Unknown
        );
    }

    #[test]
    fn a_person_with_no_copy_gives_no_copy_and_no_count() {
        let mut store = paired_store();
        let mut absent = member("staff-3", "Zawadi", Some("1111"));
        absent.as_object_mut().unwrap().remove("tillCopyPhc");
        install(
            &mut store,
            1_000,
            vec![member("staff-2", "Juma Said", None), absent],
        )
        .unwrap();
        for id in ["staff-2", "staff-3"] {
            for _ in 0..7 {
                assert_eq!(
                    store.verify_sign_in_pin(id, "1111".into(), NOW).unwrap(),
                    SignInCheck::NoCopy
                );
            }
        }
    }

    #[test]
    fn a_lock_the_server_set_counts_as_locked_until_it_ends() {
        let mut store = paired_store();
        let mut person = member("staff-1", "Amina Hassan", Some("2468"));
        person["lockedUntilMs"] = json!(NOW + 5_000);
        install(&mut store, 1_000, vec![person]).unwrap();
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW).unwrap(),
            SignInCheck::Locked { until_ms: NOW + 5_000 }
        );
        assert!(matches!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW + 5_000).unwrap(),
            SignInCheck::Ok { .. }
        ));
    }

    #[test]
    fn after_clearing_the_kit_every_check_is_unknown() {
        let mut store = paired_store();
        install(&mut store, 1_000, one_person()).unwrap();
        store.clear_sign_in_kit().unwrap();
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW).unwrap(),
            SignInCheck::Unknown
        );
        // And an older kit may be installed again: nothing is left to be older than.
        install(&mut store, 500, one_person()).unwrap();
    }

    #[test]
    fn a_revoked_till_checks_nobody() {
        let mut store = paired_store();
        install(&mut store, 1_000, one_person()).unwrap();
        store
            .connection
            .execute("UPDATE terminal_authority SET lifecycle_state='REVOKED'", [])
            .unwrap();
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "2468".into(), NOW).unwrap(),
            SignInCheck::Unknown
        );
    }

    #[test]
    fn a_refresh_keeps_the_count_for_the_same_copy_and_drops_it_for_a_new_one() {
        let mut store = paired_store();
        install(&mut store, 1_000, one_person()).unwrap();
        for _ in 0..3 {
            store.verify_sign_in_pin("staff-1", "0000".into(), NOW).unwrap();
        }
        let same = store
            .connection
            .query_row("SELECT till_copy_phc FROM sign_in_kit_staff", [], |r| r.get::<_, String>(0))
            .unwrap();
        let mut person = member("staff-1", "Amina Hassan", Some("2468"));
        person["tillCopyPhc"] = json!(same);
        install(&mut store, 2_000, vec![person]).unwrap();
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "0000".into(), NOW).unwrap(),
            SignInCheck::Wrong { attempts_left: 1 }
        );
        // A new PIN is a new copy: the old count does not follow it.
        install(&mut store, 3_000, vec![member("staff-1", "Amina Hassan", Some("9999"))]).unwrap();
        assert_eq!(
            store.verify_sign_in_pin("staff-1", "0000".into(), NOW).unwrap(),
            SignInCheck::Wrong { attempts_left: 4 }
        );
    }

    /// The point of the kit: a check at the till copy's cost is quick. Runs in
    /// CI on all three systems; the numbers are printed in the job log.
    #[test]
    fn timing_twenty_checks_of_a_correct_pin() {
        let mut store = paired_store();
        install(&mut store, 1_000, one_person()).unwrap();
        let mut millis = Vec::new();
        for _ in 0..20 {
            let started = Instant::now();
            let check = store.verify_sign_in_pin("staff-1", "2468".into(), NOW).unwrap();
            millis.push(started.elapsed().as_secs_f64() * 1000.0);
            assert!(matches!(check, SignInCheck::Ok { .. }));
        }
        millis.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let median = (millis[9] + millis[10]) / 2.0;
        let worst = millis[19];
        println!("SIGN_IN_KIT_TIMING median={median:.1}ms worst={worst:.1}ms over 20 checks");
        assert!(median <= 100.0, "median {median:.1} ms is over 100 ms");
    }
}
