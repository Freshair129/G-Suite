//! Admission contract shared by Studio and Maiden before event playback.
use crate::Package;
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap, HashSet};
fn known_events() -> Vec<String> {
    let schema: serde_json::Value =
        serde_json::from_str(include_str!("../events.json")).expect("bundled event schema");
    schema["x-events"]
        .as_array()
        .expect("events")
        .iter()
        .filter_map(|v| v["id"].as_str())
        .filter(|id| *id != "unused")
        .map(str::to_owned)
        .collect()
}
#[derive(Deserialize)]
pub(crate) struct Registry {
    schema_version: u32,
    pub announcer_id: String,
    name: String,
    revision: u32,
    locale: String,
    sounds: Vec<Sound>,
    events: BTreeMap<String, Vec<Mapping>>,
    banners: Vec<Banner>,
    components: Vec<Component>,
    unmapped_sound_ids: Vec<String>,
}
#[derive(Deserialize)]
struct Sound {
    sound_id: String,
    role: String,
    label: String,
    path: String,
    sha256: String,
}
#[derive(Deserialize)]
struct Mapping {
    sound_id: String,
    banner_id: String,
}
#[derive(Deserialize)]
struct Component {
    component_id: String,
    kind: String,
}
#[derive(Deserialize)]
struct Instance {
    instance_id: String,
    slot: String,
    component_id: String,
}
#[derive(Deserialize)]
struct Cue {
    cue_id: String,
    sound_id: String,
    time_seconds: f64,
    gain: f64,
}
#[derive(Deserialize)]
struct Visual {
    root: String,
    video: String,
    sha256: String,
    silent: bool,
}
#[derive(Deserialize)]
struct Config {
    duration_seconds: f64,
    #[serde(default)]
    visual_tail_ms: u32,
}
impl Config {
    fn valid_visual_tail(&self) -> bool {
        self.visual_tail_ms <= 3200
    }
}
#[derive(Deserialize)]
struct Banner {
    banner_id: String,
    event_key: String,
    original_sound_id: String,
    playback_sound_id: String,
    visual_source: Visual,
    components: Vec<Instance>,
    cues: Vec<Cue>,
    config: Config,
}

fn valid_id(value: &str, prefix: &str) -> bool {
    value.strip_prefix(prefix).is_some_and(|id| {
        let parts: Vec<_> = id.split('-').collect();
        parts.len() == 5
            && [8, 4, 4, 4, 12].iter().zip(parts).all(|(n, s)| {
                s.len() == *n
                    && s.bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            })
    })
}
fn require(ok: bool, reason: &str) -> Result<(), String> {
    if ok {
        Ok(())
    } else {
        Err(format!("Invalid announcer manifest: {reason}"))
    }
}
fn hash_ok(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn local_path(s: &str, folder: &str, id: &str, ext: &str) -> bool {
    s == format!("{folder}/{id}.{ext}")
}
impl Registry {
    fn validate(&self) -> Result<(), String> {
        require(
            self.schema_version == 1 && self.revision > 0 && valid_id(&self.announcer_id, "ann_"),
            "schema or announcer ID",
        )?;
        require(
            !self.name.trim().is_empty() && self.name.len() <= 256 && self.locale.len() <= 32,
            "display metadata",
        )?;
        require(
            !self.sounds.is_empty()
                && self.sounds.len() <= 256
                && self.banners.len() <= 128
                && self.components.len() <= 1024,
            "registry bounds",
        )?;
        let mut all = HashSet::new();
        let mut insert = |id: &str, prefix| {
            require(
                valid_id(id, prefix) && all.insert(id.to_owned()),
                "invalid/duplicate ID",
            )
        };
        insert(&self.announcer_id, "ann_")?;
        let mut sounds = HashMap::new();
        for s in &self.sounds {
            insert(&s.sound_id, "snd_")?;
            require(
                matches!(
                    s.role.as_str(),
                    "original_voice" | "mixed_voice_sfx" | "sfx"
                ) && s.label.len() <= 512,
                "sound role/label",
            )?;
            require(
                hash_ok(&s.sha256) && local_path(&s.path, "audio", &s.sound_id, "wav"),
                "sound path/hash",
            )?;
            sounds.insert(s.sound_id.as_str(), s);
        }
        let mut components = HashMap::new();
        for c in &self.components {
            insert(&c.component_id, "cmp_")?;
            components.insert(c.component_id.as_str(), c.kind.as_str());
        }
        let mut banners = HashMap::new();
        for b in &self.banners {
            insert(&b.banner_id, "bnr_")?;
            require(
                sounds
                    .get(b.original_sound_id.as_str())
                    .is_some_and(|s| s.role == "original_voice")
                    && sounds
                        .get(b.playback_sound_id.as_str())
                        .is_some_and(|s| s.role == "mixed_voice_sfx"),
                "banner sound role/reference",
            )?;
            require(
                b.visual_source.root == "."
                    && b.visual_source.silent
                    && hash_ok(&b.visual_source.sha256)
                    && local_path(&b.visual_source.video, "video", &b.banner_id, "webm"),
                "silent visual path/hash",
            )?;
            require(
                b.config.duration_seconds.is_finite()
                    && b.config.duration_seconds > 0.0
                    && b.config.duration_seconds <= 15.0
                    && b.config.valid_visual_tail()
                    && b.components.len() <= 16
                    && b.cues.len() <= 64,
                "banner bounds",
            )?;
            let mut slots = HashSet::new();
            for c in &b.components {
                insert(&c.instance_id, "ins_")?;
                require(
                    slots.insert(c.slot.as_str())
                        && components.get(c.component_id.as_str()) == Some(&c.slot.as_str()),
                    "component reference/slot",
                )?;
            }
            for c in &b.cues {
                insert(&c.cue_id, "cue_")?;
                require(
                    sounds
                        .get(c.sound_id.as_str())
                        .is_some_and(|s| s.role == "sfx")
                        && c.time_seconds.is_finite()
                        && (0.0..=b.config.duration_seconds).contains(&c.time_seconds)
                        && c.gain.is_finite()
                        && (0.0..=1.0).contains(&c.gain),
                    "cue reference/timing",
                )?;
            }
            banners.insert(b.banner_id.as_str(), b);
        }
        let mut used_banners = HashSet::new();
        let mut mapped = HashSet::new();
        require(
            !self.events.is_empty() && self.events.len() <= known_events().len(),
            "event count",
        )?;
        for (event, mappings) in &self.events {
            require(
                known_events().iter().any(|known| known == event)
                    && !mappings.is_empty()
                    && mappings.len() <= 128,
                "unknown/empty event",
            )?;
            let mut originals = HashSet::new();
            for m in mappings {
                let b = banners
                    .get(m.banner_id.as_str())
                    .ok_or("Missing banner reference")?;
                require(
                    b.event_key == *event
                        && b.original_sound_id == m.sound_id
                        && originals.insert(m.sound_id.as_str())
                        && used_banners.insert(m.banner_id.as_str()),
                    "event/original/banner pairing",
                )?;
                mapped.insert(m.sound_id.as_str());
            }
        }
        require(
            used_banners.len() == self.banners.len(),
            "unreferenced banner",
        )?;
        let mut unmapped = HashSet::new();
        for id in &self.unmapped_sound_ids {
            require(
                sounds
                    .get(id.as_str())
                    .is_some_and(|s| s.role == "original_voice")
                    && !mapped.contains(id.as_str())
                    && unmapped.insert(id.as_str()),
                "unmapped original conflict",
            )?;
        }
        require(
            self.sounds
                .iter()
                .filter(|s| s.role == "original_voice")
                .all(|s| {
                    mapped.contains(s.sound_id.as_str()) || unmapped.contains(s.sound_id.as_str())
                }),
            "unclassified original",
        )
    }
}

fn wav_samples(bytes: &[u8], mixed: bool) -> Result<(u64, u32), String> {
    require(
        bytes.len() >= 44
            && bytes.len() <= 16 * 1024 * 1024
            && &bytes[..4] == b"RIFF"
            && &bytes[8..12] == b"WAVE",
        "WAV header/size",
    )?;
    let u16_at = |n| u16::from_le_bytes([bytes[n], bytes[n + 1]]);
    let u32_at = |n| u32::from_le_bytes([bytes[n], bytes[n + 1], bytes[n + 2], bytes[n + 3]]);
    require(u32_at(4) as usize + 8 == bytes.len(), "WAV RIFF length")?;
    let mut offset = 12usize;
    let mut format = None;
    let mut samples = None;
    while offset + 8 <= bytes.len() {
        let length = u32_at(offset + 4) as usize;
        let end = offset
            .checked_add(8)
            .and_then(|n| n.checked_add(length))
            .ok_or("WAV overflow")?;
        require(end <= bytes.len(), "truncated WAV chunk")?;
        if &bytes[offset..offset + 4] == b"fmt " {
            require(length >= 16 && format.is_none(), "WAV format chunk")?;
            let n = offset + 8;
            let rate = u32_at(n + 4);
            require(
                u16_at(n) == 1
                    && u16_at(n + 2) == 1
                    && u16_at(n + 12) == 2
                    && u16_at(n + 14) == 16
                    && rate.checked_mul(2) == Some(u32_at(n + 8)),
                "mono PCM16 WAV",
            )?;
            require(
                if mixed {
                    rate == 48000
                } else {
                    matches!(rate, 44100 | 48000)
                },
                "WAV sample rate",
            )?;
            format = Some(rate);
        } else if &bytes[offset..offset + 4] == b"data" {
            require(
                samples.is_none()
                    && length > 0
                    && length.is_multiple_of(2)
                    && length / 2 <= 2 * 1024 * 1024,
                "WAV samples",
            )?;
            samples = Some((length / 2) as u64);
        }
        offset = end.checked_add(length % 2).ok_or("WAV overflow")?;
    }
    require(offset == bytes.len(), "WAV trailing bytes")?;
    Ok((
        samples.ok_or("WAV missing data")?,
        format.ok_or("WAV missing format")?,
    ))
}
impl Package {
    pub fn validate_playback(&self) -> Result<(), String> {
        let registry: Registry = serde_json::from_value(self.registry.clone())
            .map_err(|e| format!("GANN playback registry: {e}"))?;
        registry.validate()?;
        let mut audio = HashMap::new();
        for sound in &registry.sounds {
            let bytes = self.read(&sound.path)?;
            audio.insert(
                sound.sound_id.as_str(),
                wav_samples(&bytes, sound.role == "mixed_voice_sfx")?,
            );
        }
        for banner in &registry.banners {
            let video = self.read(&banner.visual_source.video)?;
            crate::webm::validate(&video)?;
            let original = audio[banner.original_sound_id.as_str()];
            let mixed = audio[banner.playback_sound_id.as_str()];
            require(
                (original.0 as f64 * 48000.0 / f64::from(original.1) - mixed.0 as f64).abs()
                    <= 1.0001,
                "mixed/original duration mismatch",
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod visual_tail_contract_tests {
    use super::Config;
    #[test]
    fn explicit_visual_tail_is_bounded_and_absent_tail_is_zero() {
        let original: Config = serde_json::from_str(r#"{"duration_seconds":1}"#).unwrap();
        assert_eq!(original.visual_tail_ms, 0);
        let valid: Config =
            serde_json::from_str(r#"{"duration_seconds":15,"visual_tail_ms":3200}"#).unwrap();
        assert!(valid.valid_visual_tail());
        let invalid: Config =
            serde_json::from_str(r#"{"duration_seconds":15,"visual_tail_ms":3201}"#).unwrap();
        assert!(!invalid.valid_visual_tail());
        assert!(
            serde_json::from_str::<Config>(r#"{"duration_seconds":1,"visual_tail_ms":-1}"#)
                .is_err()
        );
    }
}
