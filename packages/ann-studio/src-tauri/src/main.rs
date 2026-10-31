#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(result) = g_ann_studio::run_gann_job(&std::env::args().collect::<Vec<_>>()) {
        match result {
            Ok(report) => println!("{report}"),
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        return;
    }
    g_ann_studio::run();
}
