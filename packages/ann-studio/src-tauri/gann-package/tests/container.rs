use g_ann_package::Package;
use std::{fs, io::Write, path::PathBuf};
fn fixture() -> PathBuf {
    let path = std::env::temp_dir().join(format!("gann-red-{}.gann", std::process::id()));
    let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
    let id = "ann_00000000-0000-0000-0000-000000000001";
    let registry=serde_json::to_vec(&serde_json::json!({"schema_version":1,"announcer_id":id,"revision":1,"name":"test","sounds":[],"banners":[],"events":{}})).unwrap();
    let sha: String = ring::digest::digest(&ring::digest::SHA256, &registry)
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let manifest = format!("{id}.json");
    let index=serde_json::to_vec(&serde_json::json!({"format":"g-ann-package","version":1,"announcer_id":id,"manifest":manifest,"files":[{"path":manifest,"bytes":registry.len(),"sha256":sha}]})).unwrap();
    for (name, bytes) in [
        ("gann.json", index.as_slice()),
        (manifest.as_str(), registry.as_slice()),
    ] {
        zip.start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap();
    path
}
#[test]
fn opens_indexed_container() {
    let path = fixture();
    let result = Package::open(&path);
    let _ = fs::remove_file(path);
    assert!(
        result.is_ok(),
        "valid indexed container must open: {:?}",
        result.err()
    );
}
