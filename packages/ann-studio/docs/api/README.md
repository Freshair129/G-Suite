---
version: "0.1.0"
created_at: "2026-08-11T00:00:00+07:00,ATHER"
last_update: "2026-08-11T00:00:00+07:00,ATHER"
status: "beta"
attributes:
  doc_type: "api-index"
  scope: "G-AnnStudio local integration"
---

# G-AnnStudio API Index

The documented cross-application contract in this slice is [Overlay layout sync](../g-overlay-lab.md): `POST http://127.0.0.1:3000/overlay/layout` with the versioned 19-module layout schema. The separate Supabase Data API/storage surface is defined by the approved [private cloud threat model](../gann-cloud-threat-model.md), not by the local loopback API.

Do not infer a G-Maiden runtime API from the cloud contract: cloud data is authoring-only and cannot write runtime state.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.1.0 | 2026-08-11 | beta | Created local integration API index. | pending | ATHER |
| 0.2.0 | 2026-08-14 | candidate | Linked the approved private-cloud contract while retaining the local loopback/runtime boundary. | pending | ATHER |
