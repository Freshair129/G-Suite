use std::path::Path;
fn main() {
    if let Err(e) = run() {
        eprintln!("{e}");
        std::process::exit(1)
    }
}
fn run() -> Result<(), String> {
    let a: Vec<_> = std::env::args().collect();
    let p = match a.get(1).map(String::as_str) {
        Some("pack") if a.len() == 5 => {
            g_ann_package::create(Path::new(&a[2]), &a[3], Path::new(&a[4]))?
        }
        Some("verify") if a.len() == 3 => g_ann_package::Package::open(Path::new(&a[2]))?,
        _ => return Err("pack <root> <ann_ID.json> <output.gann> | verify <file.gann>".into()),
    };
    println!(
        "{}",
        serde_json::json!({"announcer_id":p.index.announcer_id,"files":p.index.files.len(),"sha256":p.digest,"status":"VERIFIED"})
    );
    Ok(())
}
