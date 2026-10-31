//! Bounded silent-video container admission; frame decoding remains the player's job.
//! Element identifiers follow https://www.webmproject.org/docs/container/.
fn fail(ok: bool, why: &str) -> Result<(), String> {
    if ok {
        Ok(())
    } else {
        Err(format!("GANN WebM: {why}"))
    }
}
fn vint(data: &[u8], id: bool) -> Result<(u64, usize, bool), String> {
    let first = *data.first().ok_or("Truncated EBML integer")?;
    let n = first.leading_zeros() as usize + 1;
    fail(n <= if id { 4 } else { 8 }, "invalid EBML integer")?;
    fail(data.len() >= n, "truncated EBML integer")?;
    let mut value = if id {
        u64::from(first)
    } else {
        u64::from(if n == 8 { 0 } else { first & (0xff >> n) })
    };
    for b in &data[1..n] {
        value = (value << 8) | u64::from(*b);
    }
    Ok((value, n, !id && value == (1u64 << (7 * n)) - 1))
}
fn elements(mut data: &[u8]) -> Result<Vec<(u64, &[u8])>, String> {
    let mut result = Vec::new();
    while !data.is_empty() {
        fail(result.len() < 65536, "element count")?;
        let (id, n, _) = vint(data, true)?;
        data = &data[n..];
        let (size, n, unknown) = vint(data, false)?;
        data = &data[n..];
        fail(!unknown || id == 0x18538067, "unbounded nested element")?;
        let size = if unknown {
            data.len()
        } else {
            usize::try_from(size).map_err(|_| "element size")?
        };
        fail(size <= data.len(), "truncated element")?;
        result.push((id, &data[..size]));
        data = &data[size..];
    }
    Ok(result)
}
fn uint(data: &[u8]) -> Result<u64, String> {
    fail(!data.is_empty() && data.len() <= 8, "unsigned integer")?;
    Ok(data.iter().fold(0, |value, b| (value << 8) | u64::from(*b)))
}
pub(crate) fn validate(data: &[u8]) -> Result<(), String> {
    let top = elements(data)?;
    let headers: Vec<_> = top.iter().filter(|(id, _)| *id == 0x1a45dfa3).collect();
    let segments: Vec<_> = top.iter().filter(|(id, _)| *id == 0x18538067).collect();
    fail(
        headers.len() == 1 && segments.len() == 1,
        "one header and segment required",
    )?;
    let header = elements(headers[0].1)?;
    fail(
        header
            .iter()
            .any(|(id, bytes)| *id == 0x4282 && *bytes == b"webm"),
        "WebM document type",
    )?;
    let segment = elements(segments[0].1)?;
    let tracks: Vec<_> = segment.iter().filter(|(id, _)| *id == 0x1654ae6b).collect();
    fail(tracks.len() == 1, "one track table required")?;
    let entries = elements(tracks[0].1)?;
    let entries: Vec<_> = entries.iter().filter(|(id, _)| *id == 0xae).collect();
    fail(
        entries.len() == 1,
        "exactly one silent video track required",
    )?;
    let track = elements(entries[0].1)?;
    let value = |id| {
        track
            .iter()
            .find(|(key, _)| *key == id)
            .map(|(_, v)| *v)
            .ok_or("Missing video track field".to_string())
    };
    fail(
        uint(value(0x83)?)? == 1,
        "audio/nonvideo tracks are forbidden",
    )?;
    let number = uint(value(0xd7)?)?;
    fail(number > 0, "track number")?;
    let codec = value(0x86)?;
    fail(
        codec == b"V_VP8" || codec == b"V_VP9",
        "supported video codec",
    )?;
    let video = elements(value(0xe0)?)?;
    for id in [0xb0, 0xba] {
        let value = video
            .iter()
            .find(|(key, _)| *key == id)
            .ok_or("Missing video dimensions")?
            .1;
        fail((1..=8192).contains(&uint(value)?), "video dimensions")?;
    }
    let mut frames = 0usize;
    for (_, cluster) in segment.iter().filter(|(id, _)| *id == 0x1f43b675) {
        for (id, payload) in elements(cluster)? {
            let blocks = if id == 0xa3 {
                vec![(id, payload)]
            } else if id == 0xa0 {
                elements(payload)?
            } else {
                continue;
            };
            for (id, block) in blocks {
                if id != 0xa3 && id != 0xa1 {
                    continue;
                }
                let (track, n, _) = vint(block, false)?;
                fail(
                    track == number && block.len() > n + 3,
                    "invalid video block",
                )?;
                frames += 1;
            }
        }
    }
    fail(frames > 0, "no encoded video blocks")
}
