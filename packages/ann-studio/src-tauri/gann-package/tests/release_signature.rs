use g_ann_package::{
    canonical_release_message, verify_store_release, ReleaseEnvelope, TrustedKey, TrustedKeyState,
};
use serde_json::{json, Value};

const ENVELOPE: &[u8] = include_bytes!("fixtures/release-v1.json");

fn unhex(s: &str) -> Vec<u8> {
    s.trim()
        .as_bytes()
        .chunks_exact(2)
        .map(|p| u8::from_str_radix(std::str::from_utf8(p).unwrap(), 16).unwrap())
        .collect()
}

fn test_pair() -> ring::signature::Ed25519KeyPair {
    let vector: Value =
        serde_json::from_str(include_str!("fixtures/release-v1-vector.json")).unwrap();
    ring::signature::Ed25519KeyPair::from_seed_unchecked(&unhex(
        vector["seed_hex"].as_str().unwrap(),
    ))
    .unwrap()
}

fn keys(state: TrustedKeyState) -> Vec<TrustedKey> {
    vec![TrustedKey {
        issuer: "gstore".into(),
        key_id: "test-release-2026-01".into(),
        public_key: unhex("03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8")
            .try_into()
            .unwrap(),
        state,
    }]
}

fn changed(field: &str, value: Value) -> Vec<u8> {
    let mut envelope: Value = serde_json::from_slice(ENVELOPE).unwrap();
    envelope["payload"][field] = value;
    serde_json::to_vec(&envelope).unwrap()
}

#[test]
fn independent_node_vector_verifies_and_canonical_message_matches() {
    let envelope: ReleaseEnvelope = serde_json::from_slice(ENVELOPE).unwrap();
    assert_eq!(
        canonical_release_message(&envelope.payload).unwrap(),
        unhex(include_str!("fixtures/release-v1-message.hex"))
    );
    let verified = verify_store_release(ENVELOPE, &keys(TrustedKeyState::Active)).unwrap();
    assert_eq!(
        verified.payload().release_id,
        "00000000-0000-4000-8000-000000000001"
    );
    verify_store_release(ENVELOPE, &keys(TrustedKeyState::VerifyOnly)).unwrap();
}

#[test]
fn reordered_keys_preserve_the_signature() {
    let value: Value = serde_json::from_slice(ENVELOPE).unwrap();
    let payload = value["payload"].as_object().unwrap();
    let pairs: Vec<_> = payload
        .iter()
        .rev()
        .map(|(k, v)| format!("{}:{}", serde_json::to_string(k).unwrap(), v))
        .collect();
    let reordered = format!(
        "{{\"signature\":{},\"payload\":{{{}}}}}",
        value["signature"],
        pairs.join(",")
    );
    verify_store_release(reordered.as_bytes(), &keys(TrustedKeyState::Active)).unwrap();
}

#[test]
fn every_payload_field_is_bound() {
    for (field, value) in [
        ("format", json!("other")),
        ("version", json!(2)),
        ("algorithm", json!("Ed25519ph")),
        ("key_id", json!("other-key")),
        ("issuer", json!("other")),
        ("release_id", json!("10000000-0000-4000-8000-000000000001")),
        (
            "publisher_id",
            json!("10000000-0000-4000-8000-000000000002"),
        ),
        ("item_id", json!("10000000-0000-4000-8000-000000000003")),
        (
            "announcer_id",
            json!("ann_10000000-0000-4000-8000-000000000004"),
        ),
        ("revision", json!(2)),
        ("container_sha256", json!("1".repeat(64))),
        ("container_bytes", json!(123457)),
        ("expanded_bytes", json!(234568)),
        ("compression_profile", json!("other")),
        ("issued_at", json!("2026-11-01T00:00:00Z")),
    ] {
        assert!(
            verify_store_release(&changed(field, value), &keys(TrustedKeyState::Active)).is_err(),
            "unbound {field}"
        );
    }
}

#[test]
fn trust_is_injected_and_unknown_revoked_wrong_keys_are_rejected() {
    assert_eq!(
        verify_store_release(ENVELOPE, &[]).err().unwrap().code,
        "release_unknown_key"
    );
    assert_eq!(
        verify_store_release(ENVELOPE, &keys(TrustedKeyState::Revoked))
            .err()
            .unwrap()
            .code,
        "release_revoked_key"
    );
    let mut wrong = keys(TrustedKeyState::Active);
    wrong[0].public_key = [0; 32];
    assert_eq!(
        verify_store_release(ENVELOPE, &wrong).err().unwrap().code,
        "release_signature"
    );
    let mut other_issuer = keys(TrustedKeyState::Active);
    other_issuer[0].issuer = "other".into();
    assert_eq!(
        verify_store_release(ENVELOPE, &other_issuer)
            .err()
            .unwrap()
            .code,
        "release_unknown_key"
    );
}

#[test]
fn duplicate_and_unknown_fields_are_rejected_before_signature_verification() {
    let original = std::str::from_utf8(ENVELOPE).unwrap();
    for malformed in [
        original.replacen("\"payload\": {", "\"unknown\":true,\"payload\": {", 1),
        original.replacen("\"format\":", "\"unknown\":true,\"format\":", 1),
        original.replacen("\"version\": 1", "\"version\":1,\"version\":1", 1),
        original.replacen(
            "\"signature\":",
            "\"signature\":\"duplicate\",\"signature\":",
            1,
        ),
        format!(
            "{{\"payload\":{},{}",
            serde_json::from_slice::<Value>(ENVELOPE).unwrap()["payload"],
            &original[1..]
        ),
    ] {
        assert_eq!(
            verify_store_release(malformed.as_bytes(), &keys(TrustedKeyState::Active))
                .err()
                .unwrap()
                .code,
            "release_schema"
        );
    }
}

#[test]
fn non_integer_and_unsafe_numbers_are_rejected() {
    let original = std::str::from_utf8(ENVELOPE).unwrap();
    for number in [
        "1.0",
        "1e0",
        "-1",
        "0",
        "9007199254740992",
        "18446744073709551616",
    ] {
        let malformed = original.replacen("\"revision\": 1", &format!("\"revision\":{number}"), 1);
        assert_eq!(
            verify_store_release(malformed.as_bytes(), &keys(TrustedKeyState::Active))
                .err()
                .unwrap()
                .code,
            "release_schema",
            "accepted {number}"
        );
    }
    let mut payload = serde_json::from_slice::<ReleaseEnvelope>(ENVELOPE)
        .unwrap()
        .payload;
    payload.revision = 9_007_199_254_740_992;
    assert!(canonical_release_message(&payload).is_err());
    payload.revision = 9_007_199_254_740_991;
    assert!(canonical_release_message(&payload).is_ok());
}

#[test]
fn schema_rejects_bad_identifiers_dates_profiles_and_sizes() {
    for (field, value) in [
        ("release_id", json!("A0000000-0000-4000-8000-000000000001")),
        (
            "announcer_id",
            json!("ann_00000000-0000-4000-8000-00000000000A"),
        ),
        ("container_sha256", json!("A".repeat(64))),
        ("key_id", json!("bad_key")),
        ("key_id", json!("a".repeat(65))),
        ("key_id", json!("ก")),
        ("issuer", json!("gstore\n")),
        ("container_bytes", json!(0)),
        ("container_bytes", json!(536870913u64)),
        ("expanded_bytes", json!(0)),
        ("expanded_bytes", json!(536870913u64)),
        ("issued_at", json!("2026-02-29T00:00:00Z")),
        ("issued_at", json!("1900-02-29T00:00:00Z")),
        ("issued_at", json!("2026-04-31T00:00:00Z")),
        ("issued_at", json!("2026-10-31T24:00:00Z")),
        ("issued_at", json!("2026-10-31T00:00:00.0Z")),
        ("issued_at", json!("2026-10-31T00:00:00+00:00")),
    ] {
        assert_eq!(
            verify_store_release(&changed(field, value), &keys(TrustedKeyState::Active))
                .err()
                .unwrap()
                .code,
            "release_schema",
            "invalid {field}"
        );
    }
}

#[test]
fn signature_requires_canonical_unpadded_base64url_and_64_bytes() {
    let mut envelope: Value = serde_json::from_slice(ENVELOPE).unwrap();
    let signature = envelope["signature"].as_str().unwrap().to_owned();
    for malformed in [
        format!("{signature}="),
        "+".repeat(86),
        "/".repeat(86),
        "A".repeat(85),
        "A".repeat(87),
        format!("{}x", &signature[..85]),
    ] {
        envelope["signature"] = json!(malformed);
        assert_eq!(
            verify_store_release(
                &serde_json::to_vec(&envelope).unwrap(),
                &keys(TrustedKeyState::Active)
            )
            .err()
            .unwrap()
            .code,
            "release_schema"
        );
    }
}

#[test]
fn envelope_limit_includes_all_whitespace() {
    let mut limit = ENVELOPE.to_vec();
    limit.resize(16384, b' ');
    verify_store_release(&limit, &keys(TrustedKeyState::Active)).unwrap();
    limit.push(b' ');
    assert_eq!(
        verify_store_release(&limit, &keys(TrustedKeyState::Active))
            .err()
            .unwrap()
            .code,
        "release_envelope_size"
    );
}

#[test]
fn signature_from_another_domain_is_rejected() {
    let pair = test_pair();
    let mut envelope: ReleaseEnvelope = serde_json::from_slice(ENVELOPE).unwrap();
    let message = unhex(include_str!("fixtures/release-v1-message.hex"));
    let wrong = [
        b"gmaiden-store-install-v2\n".as_slice(),
        &message[b"gmaiden-gann-store-release-v1\n".len()..],
    ]
    .concat();
    use base64::Engine;
    envelope.signature =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(pair.sign(&wrong).as_ref());
    assert_eq!(
        verify_store_release(
            &serde_json::to_vec(&envelope).unwrap(),
            &keys(TrustedKeyState::Active)
        )
        .err()
        .unwrap()
        .code,
        "release_signature"
    );
}

fn signed(payload: &g_ann_package::ReleasePayload) -> Vec<u8> {
    use base64::Engine;
    let pair = test_pair();
    serde_json::to_vec(&ReleaseEnvelope {
        payload: payload.clone(),
        signature: base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(
            pair.sign(&canonical_release_message(payload).unwrap())
                .as_ref(),
        ),
    })
    .unwrap()
}

#[test]
fn verified_release_binds_all_package_identity_and_compression_results() {
    use g_ann_package::{create, validate_producer_profile};
    let root = std::env::temp_dir().join(format!("gann-release-package-{}", std::process::id()));
    let source = root.join("source");
    std::fs::create_dir_all(&source).unwrap();
    let id = "ann_00000000-0000-4000-8000-000000000004";
    let manifest = format!("{id}.json");
    std::fs::write(source.join(&manifest), serde_json::to_vec(&json!({
        "schema_version":1,"announcer_id":id,"revision":1,"name":"release fixture","sounds":[],"banners":[],"events":{}
    })).unwrap()).unwrap();
    let path = root.join("package.gann");
    let mut package = create(&source, &manifest, &path).unwrap();
    let report = validate_producer_profile(&path).unwrap();
    let mut payload = serde_json::from_slice::<ReleaseEnvelope>(ENVELOPE)
        .unwrap()
        .payload;
    payload.container_sha256 = package.digest.clone();
    payload.container_bytes = report.container_bytes;
    payload.expanded_bytes = report.expanded_bytes;
    let release = verify_store_release(&signed(&payload), &keys(TrustedKeyState::Active)).unwrap();
    release.check_package(&package, &report).unwrap();

    for (field, value) in [
        ("container_sha256", json!("1".repeat(64))),
        ("container_bytes", json!(payload.container_bytes + 1)),
        ("expanded_bytes", json!(payload.expanded_bytes + 1)),
        ("revision", json!(2)),
        (
            "announcer_id",
            json!("ann_10000000-0000-4000-8000-000000000004"),
        ),
    ] {
        let mut changed = serde_json::to_value(&payload).unwrap();
        changed[field] = value;
        let changed = serde_json::from_value(changed).unwrap();
        let mismatch =
            verify_store_release(&signed(&changed), &keys(TrustedKeyState::Active)).unwrap();
        assert_eq!(
            mismatch.check_package(&package, &report).unwrap_err().code,
            "release_package_mismatch",
            "unbound {field}"
        );
    }
    let mut bad_profile = report.clone();
    bad_profile.profile = "other".into();
    assert_eq!(
        release
            .check_package(&package, &bad_profile)
            .unwrap_err()
            .code,
        "release_package_mismatch"
    );
    let original_bytes = std::fs::read(&path).unwrap();
    let mut changed_bytes = original_bytes.clone(); changed_bytes.extend(b"hidden");
    std::fs::write(&path, changed_bytes).unwrap();
    assert!(release.check_package(&package, &report).is_err(), "caller claims must not hide changed archive bytes");
    std::fs::write(&path, original_bytes).unwrap();
    package.registry["announcer_id"] = json!("ann_10000000-0000-4000-8000-000000000004");
    assert_eq!(
        release.check_package(&package, &report).unwrap_err().code,
        "release_package_mismatch"
    );
    std::fs::remove_dir_all(root).unwrap();
}
