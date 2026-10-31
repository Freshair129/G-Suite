//! Detached Store authority. Trust keys are supplied by the application, never the package.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fmt};

const DOMAIN: &[u8] = b"gmaiden-gann-store-release-v1\n";
const MAX_ENVELOPE: usize = 16_384;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PackageError {
    pub code: String,
    pub detail: String,
}

impl PackageError {
    pub fn new(code: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            detail: detail.into(),
        }
    }
}

impl fmt::Display for PackageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "GANN {}: {}", self.code, self.detail)
    }
}

impl std::error::Error for PackageError {}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReleasePayload {
    pub format: String,
    pub version: u64,
    pub algorithm: String,
    pub key_id: String,
    pub issuer: String,
    pub release_id: String,
    pub publisher_id: String,
    pub item_id: String,
    pub announcer_id: String,
    pub revision: u64,
    pub container_sha256: String,
    pub container_bytes: u64,
    pub expanded_bytes: u64,
    pub compression_profile: String,
    pub issued_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReleaseEnvelope {
    pub payload: ReleasePayload,
    pub signature: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrustedKeyState {
    Active,
    VerifyOnly,
    Revoked,
}

#[derive(Clone, Debug)]
pub struct TrustedKey {
    pub issuer: String,
    pub key_id: String,
    pub public_key: [u8; 32],
    pub state: TrustedKeyState,
}

#[derive(Clone, Debug)]
pub struct VerifiedRelease {
    payload: ReleasePayload,
}

impl VerifiedRelease {
    pub fn payload(&self) -> &ReleasePayload {
        &self.payload
    }

    pub fn check_package(
        &self,
        package: &crate::Package,
        report: &crate::CompressionReport,
    ) -> Result<(), PackageError> {
        let fresh = crate::Package::open(&package.path).map_err(|e| PackageError::new("release_package_mismatch", e))?;
        let actual = crate::validate_producer_profile(&package.path).map_err(|e| PackageError::new("release_package_mismatch", e))?;
        if fresh.digest != package.digest || fresh.index.announcer_id != package.index.announcer_id
            || fresh.registry != package.registry || actual.profile != report.profile
            || actual.container_bytes != report.container_bytes || actual.expanded_bytes != report.expanded_bytes
            || actual.entry_count != report.entry_count {
            return Err(PackageError::new("release_package_mismatch", "caller validation claims differ from archive"));
        }
        let payload = &self.payload;
        if payload.container_sha256 != package.digest
            || payload.container_bytes != report.container_bytes
            || payload.expanded_bytes != report.expanded_bytes
            || payload.compression_profile != report.profile
            || payload.announcer_id != package.index.announcer_id
            || package.registry["announcer_id"].as_str() != Some(payload.announcer_id.as_str())
            || package.registry["revision"].as_u64() != Some(payload.revision)
        {
            return Err(PackageError::new(
                "release_package_mismatch",
                "validated package does not match the signed release",
            ));
        }
        Ok(())
    }
}

fn schema(detail: &str) -> PackageError {
    PackageError::new("release_schema", detail)
}

fn valid_timestamp(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 20
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
        || b[19] != b'Z'
        || !b
            .iter()
            .enumerate()
            .all(|(i, c)| matches!(i, 4 | 7 | 10 | 13 | 16 | 19) || c.is_ascii_digit())
    {
        return false;
    }
    let number = |range: std::ops::Range<usize>| {
        b[range]
            .iter()
            .fold(0u32, |n, c| n * 10 + u32::from(c - b'0'))
    };
    let (year, month, day, hour, minute, second) = (
        number(0..4),
        number(5..7),
        number(8..10),
        number(11..13),
        number(14..16),
        number(17..19),
    );
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => return false,
    };
    day >= 1
        && day <= days
        && hour <= 23
        && minute <= 59
        && (second <= 59
            || (second == 60
                && hour == 23
                && minute == 59
                && ((month == 6 && day == 30) || (month == 12 && day == 31))))
}

impl ReleasePayload {
    fn validate(&self) -> Result<(), PackageError> {
        if self.format != "gann-store-release"
            || self.version != 1
            || self.algorithm != "Ed25519"
            || self.issuer != "gstore"
            || self.compression_profile != "gann-zip-1"
        {
            return Err(schema(
                "unsupported release format, algorithm, issuer or compression profile",
            ));
        }
        if self.key_id.is_empty()
            || self.key_id.len() > 64
            || !self
                .key_id
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
            || self.key_id.starts_with('-')
        {
            return Err(schema("invalid release key identifier"));
        }
        if !crate::valid_id(&self.release_id, "")
            || !crate::valid_id(&self.publisher_id, "")
            || !crate::valid_id(&self.item_id, "")
            || !crate::valid_id(&self.announcer_id, "ann_")
        {
            return Err(schema("invalid lowercase release identity"));
        }
        if self.container_sha256.len() != 64
            || !self
                .container_sha256
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        {
            return Err(schema("invalid lowercase container digest"));
        }
        if self.revision == 0
            || self.revision > MAX_SAFE_INTEGER
            || self.container_bytes == 0
            || self.container_bytes > crate::MAX_PACKAGE
            || self.expanded_bytes == 0
            || self.expanded_bytes > crate::MAX_PACKAGE
        {
            return Err(schema("release integer outside supported range"));
        }
        if !valid_timestamp(&self.issued_at) {
            return Err(schema("invalid UTC release timestamp"));
        }
        Ok(())
    }
}

pub fn canonical_release_message(payload: &ReleasePayload) -> Result<Vec<u8>, PackageError> {
    payload.validate()?;
    // The v1 schema permits ASCII-only strings and safe positive integers. For this
    // subset, sorted serde_json serialization is exactly RFC 8785 (no float/UTF-16 cases).
    let fields: BTreeMap<String, serde_json::Value> = serde_json::from_value(
        serde_json::to_value(payload).map_err(|_| schema("cannot serialize release payload"))?,
    )
    .map_err(|_| schema("cannot canonicalize release payload"))?;
    let mut message = DOMAIN.to_vec();
    serde_json::to_writer(&mut message, &fields)
        .map_err(|_| schema("cannot canonicalize release payload"))?;
    Ok(message)
}

pub fn verify_store_release(
    envelope_bytes: &[u8],
    keys: &[TrustedKey],
) -> Result<VerifiedRelease, PackageError> {
    if envelope_bytes.len() > MAX_ENVELOPE {
        return Err(PackageError::new(
            "release_envelope_size",
            "release envelope exceeds 16384 bytes",
        ));
    }
    let envelope: ReleaseEnvelope = serde_json::from_slice(envelope_bytes)
        .map_err(|_| schema("invalid release envelope fields or JSON"))?;
    let message = canonical_release_message(&envelope.payload)?;
    let signature = URL_SAFE_NO_PAD
        .decode(&envelope.signature)
        .map_err(|_| schema("invalid unpadded Base64url signature"))?;
    if signature.len() != 64 || URL_SAFE_NO_PAD.encode(&signature) != envelope.signature {
        return Err(schema("signature must encode exactly 64 bytes canonically"));
    }
    let matching: Vec<_> = keys
        .iter()
        .filter(|k| k.issuer == envelope.payload.issuer && k.key_id == envelope.payload.key_id)
        .collect();
    if matching.is_empty() {
        return Err(PackageError::new(
            "release_unknown_key",
            "release key is not trusted; update the application",
        ));
    }
    if matching.iter().any(|k| k.state == TrustedKeyState::Revoked) {
        return Err(PackageError::new(
            "release_revoked_key",
            "release key has been revoked",
        ));
    }
    if matching.len() != 1 {
        return Err(PackageError::new(
            "release_unknown_key",
            "ambiguous release trust configuration",
        ));
    }
    ring::signature::UnparsedPublicKey::new(&ring::signature::ED25519, matching[0].public_key)
        .verify(&message, &signature)
        .map_err(|_| {
            PackageError::new("release_signature", "release signature verification failed")
        })?;
    Ok(VerifiedRelease {
        payload: envelope.payload,
    })
}
