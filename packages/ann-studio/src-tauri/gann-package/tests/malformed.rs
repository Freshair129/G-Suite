use g_ann_package::{sha256, Package};
use serde_json::{json, Value};
use std::{fs, io::Write, path::PathBuf};
fn make(kind: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("gann-{kind}-{}.gann", std::process::id()));
    let id = "ann_00000000-0000-0000-0000-000000000001";
    let manifest = format!("{id}.json");
    let name = if kind == "metadata" {
        json!({})
    } else {
        json!("test")
    };
    let registry=serde_json::to_vec(&json!({"schema_version":1,"announcer_id":id,"revision":1,"name":name,"sounds":[],"banners":[],"events":{}})).unwrap();
    let mut index = json!({"format":"g-ann-package","version":1,"announcer_id":id,"manifest":manifest,"files":[{"path":manifest,"bytes":registry.len(),"sha256":sha256(&registry)}]});
    match kind {
        "version" => index["version"] = 2.into(),
        "hash" => index["files"][0]["sha256"] = "0".repeat(64).into(),
        "size" => index["files"][0]["bytes"] = 1.into(),
        "identity" => index["announcer_id"] = "ann_../escape".into(),
        _ => {}
    }
    let mut zip = zip::ZipWriter::new(fs::File::create(&p).unwrap());
    let opt = zip::write::SimpleFileOptions::default();
    for (n, b) in [
        ("gann.json", serde_json::to_vec(&index).unwrap()),
        (manifest.as_str(), registry),
    ] {
        if kind == "missing" && n == manifest {
            continue;
        }
        zip.start_file(n, opt).unwrap();
        zip.write_all(&b).unwrap();
    }
    let extra = match kind {
        "traversal" => Some("../escape"),
        "drive" => Some("C:/escape"),
        "unc" => Some("//server/share"),
        "backslash" => Some("motion\\x"),
        "reserved" => Some("motion/CON.txt"),
        "case" => Some("GANN.JSON"),
        "extra" => Some("extra.txt"),
        _ => None,
    };
    if let Some(n) = extra {
        zip.start_file(n, opt).unwrap();
        zip.write_all(b"bad").unwrap();
    }
    if kind == "symlink" {
        zip.add_symlink("motion/link", "outside", opt).unwrap();
    }
    zip.finish().unwrap();
    p
}
#[test]
fn refuses_tamper_unsafe_names_and_unindexed_payloads() {
    for kind in [
        "version",
        "hash",
        "size",
        "identity",
        "missing",
        "traversal",
        "drive",
        "unc",
        "backslash",
        "reserved",
        "case",
        "extra",
        "symlink",
    ] {
        let p = make(kind);
        assert!(Package::open(&p).is_err(), "{kind}");
        fs::remove_file(p).unwrap();
    }
}
#[test]
fn extraction_and_copy_preserve_bytes_and_refuse_overwrite() {
    let p = make("valid");
    let pack = Package::open(&p).unwrap();
    let root = p.with_extension("dir");
    fs::create_dir(&root).unwrap();
    pack.extract(&root).unwrap();
    let raw = fs::read(root.join(&pack.index.manifest)).unwrap();
    let v: Value = serde_json::from_slice(&raw).unwrap();
    assert_eq!(v["announcer_id"], pack.index.announcer_id);
    assert!(pack.extract(&root).is_err());
    assert!(pack.read("../outside").is_err());
    let copy = p.with_extension("copy.gann");
    pack.save_copy(&copy).unwrap();
    assert_eq!(fs::read(&p).unwrap(), fs::read(&copy).unwrap());
    assert!(pack.save_copy(&copy).is_err());
    fs::write(&p, b"changed").unwrap();
    assert!(pack.read(&pack.index.manifest).is_err());
    fs::remove_dir_all(root).unwrap();
    fs::remove_file(p).unwrap();
    fs::remove_file(copy).unwrap();
}

#[test]
fn rejects_invalid_display_metadata() {
    let p = make("metadata");
    let result = Package::open(&p);
    fs::remove_file(p).unwrap();
    assert!(result.is_err(), "object name must not reach React");
}
#[test]
fn failed_copy_leaves_no_destination() {
    let p = make("copy-fail");
    let package = Package::open(&p).unwrap();
    fs::write(&p, b"changed").unwrap();
    let dest = p.with_extension("failed.gann");
    let result = package.save_copy(&dest);
    let exists = dest.exists();
    let _ = fs::remove_file(&dest);
    fs::remove_file(p).unwrap();
    assert!(result.is_err());
    assert!(!exists, "failed copy must not leave a final file");
}
