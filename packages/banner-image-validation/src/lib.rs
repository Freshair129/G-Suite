//! Decode untrusted still-banner images with explicit format and resource limits.
use std::io::{BufReader, Read, Seek};

pub fn validate<R: Read + Seek>(source: R, media_type: &str) -> Result<(), String> {
    let expected = match media_type {
        "image/png" => image::ImageFormat::Png,
        "image/jpeg" => image::ImageFormat::Jpeg,
        "image/webp" => image::ImageFormat::WebP,
        _ => return Err("Unsupported image media type".into()),
    };
    let mut reader = image::ImageReader::new(BufReader::new(source))
        .with_guessed_format()
        .map_err(|error| format!("Cannot inspect image: {error}"))?;
    if reader.format() != Some(expected) {
        return Err("Image bytes do not match the declared media type".into());
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|error| format!("Invalid banner image: {error}"))?;
    Ok(())
}
