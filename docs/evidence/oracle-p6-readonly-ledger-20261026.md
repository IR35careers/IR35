# P6 retained queue ledger — read-only, 26 October 2026

Observed by the third diagnostic collection, not a fourth P6 run. All 74 retained ledger rows are below, plus the separate heartbeat. No rows were created, removed, reset or retried by this diagnosis.

Source: [sealed JSON](p6/restart-diagnosis-20261026-03/04-queue-ledger-result.json). The second read [matched exactly](p6/restart-diagnosis-20261026-03/07-ledger-after-result.json), excluding the expected 15-second heartbeat. Stable ledger SHA256: `2893901781b68b981837a78bb676161f18c954ba075b93dbb14737ddca8aafed`.

Application and schedule-receipt tables do not store `created_at`; these cells are explicitly missing, not inferred. Queue `created_at` below is `pgboss.job.created_on`. Application attempts count sealed `running` events; job attempts use started_on/retry_count. Schedule execution attempts are in the corresponding queue row.

## application (34)

| id | status | created_at | requested_at | updated_at | attempts | scenario | error_code |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0a67fb46-fdc7-4d88-be27-23d4d5ef7f44 | submitted | not stored | 2026-10-25T14:08:43.663+00:00 | 2026-10-25T14:08:45.985561+00:00 | 1 | success | NULL |
| 1af09294-30a2-45de-b187-8f1ca60964b8 | failed | not stored | 2026-10-26T08:16:37.724+00:00 | 2026-10-26T08:16:39.862471+00:00 | 1 | lost_ack | mock_unknown_outcome |
| 1dc7170f-7992-470b-b626-c543bb57c347 | failed | not stored | 2026-10-25T22:30:14.125+00:00 | 2026-10-25T22:30:16.391369+00:00 | 1 | lost_ack | mock_unknown_outcome |
| 245a70e1-74d3-453a-9625-9a605940cbaf | failed | not stored | 2026-10-26T08:16:49.205+00:00 | 2026-10-26T08:16:49.649625+00:00 | 1 | timeout | mock_cancelled |
| 2621de4a-4348-43ef-ae68-6ebbcb2a295b | failed | not stored | 2026-10-26T08:16:20.349+00:00 | 2026-10-26T08:16:37.171439+00:00 | 1 | timeout | mock_ats_timeout |
| 26baa57f-63eb-4d3f-86ac-a9cc2fcc42b9 | submitted | not stored | 2026-10-25T22:30:20.412+00:00 | 2026-10-25T22:30:22.40721+00:00 | 1 | success | NULL |
| 37bf2056-99db-458e-8c1d-7dc7a75b2a01 | failed | not stored | 2026-10-25T14:09:06.677+00:00 | 2026-10-25T14:09:08.850931+00:00 | 1 | lost_ack | mock_browser_failed |
| 483719d9-43bb-4783-ad21-8766d0042f4a | failed | not stored | 2026-10-26T08:16:40.364+00:00 | 2026-10-26T08:16:41.73384+00:00 | 1 | captcha | mock_captcha_required |
| 4bd23f80-5895-4a54-8d61-aa074e86db06 | failed | not stored | 2026-10-26T07:44:55.914+00:00 | 2026-10-26T07:44:57.433077+00:00 | 1 | unknown_answer | mock_input_required |
| 4d38cbde-e120-44fd-b2a6-ac703e37a3de | failed | not stored | 2026-10-26T07:44:34.878+00:00 | 2026-10-26T07:44:51.936192+00:00 | 1 | timeout | mock_ats_timeout |
| 4ecd7ecb-e2fc-4137-be2d-536227a26682 | submitted | not stored | 2026-10-25T22:30:20.412+00:00 | 2026-10-25T22:30:24.382902+00:00 | 1 | success | NULL |
| 5030aa69-ac86-4668-b09c-25051670c84a | failed | not stored | 2026-10-25T22:29:53.75+00:00 | 2026-10-25T22:29:55.537729+00:00 | 1 | server_error | mock_ats_http_500 |
| 571f4911-a041-4fec-88f9-24ada9fef9f0 | failed | not stored | 2026-10-26T07:44:52.204+00:00 | 2026-10-26T07:44:53.596476+00:00 | 1 | lost_ack | mock_unknown_outcome |
| 62bdf063-df9a-4030-8f72-9946c8c27b1c | failed | not stored | 2026-10-26T07:45:01.918+00:00 | 2026-10-26T07:45:02.953173+00:00 | 0 | success | mock_cancelled |
| 6651fa63-857c-4c48-bf2c-7c98583797a2 | submitted | not stored | 2026-10-25T22:29:51.109+00:00 | 2026-10-25T22:29:53.443249+00:00 | 1 | success | NULL |
| 7648a13b-e701-4fd5-ab9b-74a32e83b17e | submitted | not stored | 2026-10-26T08:16:44.026+00:00 | 2026-10-26T08:16:47.922204+00:00 | 1 | success | NULL |
| 795acb94-4d88-449c-ab4f-ab2cc823cab8 | failed | not stored | 2026-10-25T14:08:48.56+00:00 | 2026-10-25T14:09:06.194611+00:00 | 1 | timeout | mock_ats_timeout |
| 7f66a1d6-f999-4333-9a37-e3118ea820c5 | failed | not stored | 2026-10-25T22:30:18.594+00:00 | 2026-10-25T22:30:20.117165+00:00 | 1 | unknown_answer | mock_input_required |
| 86b5e7a4-28a2-404d-bb7e-43e3d77b63ae | submitted | not stored | 2026-10-26T08:16:15.868+00:00 | 2026-10-26T08:16:17.927492+00:00 | 1 | success | NULL |
| 9878c2cc-4219-423c-8e38-3706fbacd804 | failed | not stored | 2026-10-26T08:16:42.186+00:00 | 2026-10-26T08:16:43.834296+00:00 | 1 | unknown_answer | mock_input_required |
| 9a6a1789-0b34-4e8d-b9f4-f64705f26fb6 | submitted | not stored | 2026-10-26T07:44:31.181+00:00 | 2026-10-26T07:44:32.614394+00:00 | 1 | success | NULL |
| 9b1812b4-1e99-4b64-bdbc-25aff7f44605 | submitted | not stored | 2026-10-26T07:44:57.736+00:00 | 2026-10-26T07:44:59.688986+00:00 | 1 | success | NULL |
| a117660f-c280-4e91-a623-77e7bc2f6d80 | failed | not stored | 2026-10-26T07:44:04.444697+00:00 | 2026-10-26T07:45:15.284004+00:00 | 0 | success | runner_timeout |
| a3f89222-0d99-412b-ae1b-6106dfffe8a1 | submitted | not stored | 2026-10-26T07:44:57.736+00:00 | 2026-10-26T07:45:01.639755+00:00 | 1 | success | NULL |
| a434139b-6bfc-4a67-9cf1-2bc0388fd025 | failed | not stored | 2026-10-25T22:29:55.99+00:00 | 2026-10-25T22:30:13.65673+00:00 | 1 | timeout | mock_ats_timeout |
| b7ac17f1-799d-43ba-93c0-a1434e518350 | failed | not stored | 2026-10-26T08:15:50.572538+00:00 | 2026-10-26T08:16:52.516423+00:00 | 0 | success | runner_timeout |
| c44c4c7e-e4eb-43e9-8c97-81ad94110cb9 | failed | not stored | 2026-10-26T07:44:33.009+00:00 | 2026-10-26T07:44:34.67055+00:00 | 1 | server_error | mock_ats_http_500 |
| c57c0353-4c25-41af-a8fc-0b914986ea98 | submitted | not stored | 2026-10-26T08:16:44.026+00:00 | 2026-10-26T08:16:45.855901+00:00 | 1 | success | NULL |
| cc36b6f4-db27-48fb-989c-020d4fa4844e | failed | not stored | 2026-10-26T07:45:02.971+00:00 | 2026-10-26T07:45:03.410378+00:00 | 1 | timeout | mock_cancelled |
| cdcf368d-38ae-46c8-955b-65e6d0c74b5d | failed | not stored | 2026-10-25T14:08:46.32+00:00 | 2026-10-25T14:08:48.071379+00:00 | 1 | server_error | mock_ats_http_500 |
| e2a68943-e410-40de-ae53-4192fdd792d8 | failed | not stored | 2026-10-25T22:30:16.772+00:00 | 2026-10-25T22:30:18.137499+00:00 | 1 | captcha | mock_captcha_required |
| ee41a8bb-3092-49c9-8a40-af7cea44bcd6 | failed | not stored | 2026-10-26T08:16:18.109+00:00 | 2026-10-26T08:16:19.877623+00:00 | 1 | server_error | mock_ats_http_500 |
| f54f34c5-34c5-41bd-a03e-3e9ea6c6f791 | failed | not stored | 2026-10-26T08:16:48.193+00:00 | 2026-10-26T08:16:49.187169+00:00 | 0 | success | mock_cancelled |
| f8959449-b0eb-4943-9fd7-0fa9f7813b9e | failed | not stored | 2026-10-26T07:44:54.075+00:00 | 2026-10-26T07:44:55.482212+00:00 | 1 | captcha | mock_captcha_required |

## queue_job (36)

| id | status | created_at | attempts | queue | operation |
| --- | --- | --- | --- | --- | --- |
| 0a67fb46-fdc7-4d88-be27-23d4d5ef7f44 | completed | 2026-10-25T14:08:43.678164+00:00 | 1 | ir35-staging-mock-apply | NULL |
| 1af09294-30a2-45de-b187-8f1ca60964b8 | failed | 2026-10-26T08:16:37.730982+00:00 | 1 | ir35-staging-mock-apply | NULL |
| 1dc7170f-7992-470b-b626-c543bb57c347 | failed | 2026-10-25T22:30:14.131279+00:00 | 1 | ir35-staging-mock-apply | NULL |
| 245a70e1-74d3-453a-9625-9a605940cbaf | cancelled | 2026-10-26T08:16:49.211003+00:00 | 1 | ir35-staging-mock-apply | NULL |
| 2621de4a-4348-43ef-ae68-6ebbcb2a295b | failed | 2026-10-26T08:16:20.355207+00:00 | 1 | ir35-staging-mock-apply | NULL |
| 26baa57f-63eb-4d3f-86ac-a9cc2fcc42b9 | completed | 2026-10-25T22:30:20.417944+00:00 | 1 | ir35-staging-mock-apply | NULL |
| 365d051d-895f-4c12-93ee-4229fb75cebc | completed | 2026-10-26T08:16:52.681481+00:00 | 1 | ir35-staging-mock-schedule | mock_ingest |
| 37bf2056-99db-458e-8c1d-7dc7a75b2a01 | failed | 2026-10-25T14:09:06.68365+00:00 | 1 | ir35-staging-mock-apply | NULL |
| 3abed4da-364e-446a-ab64-9f01ef0df524 | completed | 2026-10-26T08:16:52.708315+00:00 | 1 | ir35-staging-mock-schedule | watchdog |
| 483719d9-43bb-4783-ad21-8766d0042f4a | failed | 2026-10-26T08:16:40.369988+00:00 | 1 | ir35-staging-mock-apply | NULL |
| 4bd23f80-5895-4a54-8d61-aa074e86db06 | failed | 2026-10-26T07:44:55.920508+00:00 | 1 | ir35-staging-mock-apply | NULL |
| 4d38cbde-e120-44fd-b2a6-ac703e37a3de | failed | 2026-10-26T07:44:34.884834+00:00 | 1 | ir35-staging-mock-apply | NULL |
| 4ecd7ecb-e2fc-4137-be2d-536227a26682 | completed | 2026-10-25T22:30:20.428044+00:00 | 1 | ir35-staging-mock-apply | NULL |
| 5030aa69-ac86-4668-b09c-25051670c84a | failed | 2026-10-25T22:29:53.756079+00:00 | 1 | ir35-staging-mock-apply | NULL |
| 571f4911-a041-4fec-88f9-24ada9fef9f0 | failed | 2026-10-26T07:44:52.210083+00:00 | 1 | ir35-staging-mock-apply | NULL |
| 62bdf063-df9a-4030-8f72-9946c8c27b1c | cancelled | 2026-10-26T07:45:02.879447+00:00 | 0 | ir35-staging-mock-apply | NULL |
| 6651fa63-857c-4c48-bf2c-7c98583797a2 | completed | 2026-10-25T22:29:51.116776+00:00 | 1 | ir35-staging-mock-apply | NULL |
| 739f99f2-6f6b-4b70-990a-f9d656e29247 | completed | 2026-10-26T08:16:52.69495+00:00 | 1 | ir35-staging-mock-schedule | mock_automation |
| 7648a13b-e701-4fd5-ab9b-74a32e83b17e | completed | 2026-10-26T08:16:44.042376+00:00 | 1 | ir35-staging-mock-apply | NULL |
| 795acb94-4d88-449c-ab4f-ab2cc823cab8 | failed | 2026-10-25T14:08:48.566765+00:00 | 1 | ir35-staging-mock-apply | NULL |
| 7f66a1d6-f999-4333-9a37-e3118ea820c5 | failed | 2026-10-25T22:30:18.599547+00:00 | 1 | ir35-staging-mock-apply | NULL |
| 86b5e7a4-28a2-404d-bb7e-43e3d77b63ae | completed | 2026-10-26T08:16:15.87558+00:00 | 1 | ir35-staging-mock-apply | NULL |
| 9094be50-696a-4207-9450-53cec2cc3b73 | completed | 2026-10-26T07:45:15.536923+00:00 | 1 | ir35-staging-mock-schedule | mock_ingest |
| 9878c2cc-4219-423c-8e38-3706fbacd804 | failed | 2026-10-26T08:16:42.191858+00:00 | 1 | ir35-staging-mock-apply | NULL |
| 9a6a1789-0b34-4e8d-b9f4-f64705f26fb6 | completed | 2026-10-26T07:44:31.188687+00:00 | 1 | ir35-staging-mock-apply | NULL |
| 9b1812b4-1e99-4b64-bdbc-25aff7f44605 | completed | 2026-10-26T07:44:57.742256+00:00 | 1 | ir35-staging-mock-apply | NULL |
| a3f89222-0d99-412b-ae1b-6106dfffe8a1 | completed | 2026-10-26T07:44:57.752649+00:00 | 1 | ir35-staging-mock-apply | NULL |
| a434139b-6bfc-4a67-9cf1-2bc0388fd025 | failed | 2026-10-25T22:29:55.996287+00:00 | 1 | ir35-staging-mock-apply | NULL |
| c44c4c7e-e4eb-43e9-8c97-81ad94110cb9 | failed | 2026-10-26T07:44:33.014485+00:00 | 1 | ir35-staging-mock-apply | NULL |
| c57c0353-4c25-41af-a8fc-0b914986ea98 | completed | 2026-10-26T08:16:44.032186+00:00 | 1 | ir35-staging-mock-apply | NULL |
| cc36b6f4-db27-48fb-989c-020d4fa4844e | cancelled | 2026-10-26T07:45:02.976705+00:00 | 1 | ir35-staging-mock-apply | NULL |
| cdcf368d-38ae-46c8-955b-65e6d0c74b5d | failed | 2026-10-25T14:08:46.326127+00:00 | 1 | ir35-staging-mock-apply | NULL |
| e2a68943-e410-40de-ae53-4192fdd792d8 | failed | 2026-10-25T22:30:16.777721+00:00 | 1 | ir35-staging-mock-apply | NULL |
| ee41a8bb-3092-49c9-8a40-af7cea44bcd6 | failed | 2026-10-26T08:16:18.115389+00:00 | 1 | ir35-staging-mock-apply | NULL |
| f54f34c5-34c5-41bd-a03e-3e9ea6c6f791 | cancelled | 2026-10-26T08:16:49.111676+00:00 | 0 | ir35-staging-mock-apply | NULL |
| f8959449-b0eb-4943-9fd7-0fa9f7813b9e | failed | 2026-10-26T07:44:54.080509+00:00 | 1 | ir35-staging-mock-apply | NULL |

## schedule_receipt (4)

| id | status | created_at | completed_at | attempts | operation |
| --- | --- | --- | --- | --- | --- |
| 365d051d-895f-4c12-93ee-4229fb75cebc | completed | not stored | 2026-10-26T08:16:53.54581+00:00 | not stored | mock_ingest |
| 3abed4da-364e-446a-ab64-9f01ef0df524 | completed | not stored | 2026-10-26T08:16:55.548437+00:00 | not stored | watchdog |
| 739f99f2-6f6b-4b70-990a-f9d656e29247 | completed | not stored | 2026-10-26T08:16:54.550956+00:00 | not stored | mock_automation |
| 9094be50-696a-4207-9450-53cec2cc3b73 | completed | not stored | 2026-10-26T08:02:23.245454+00:00 | not stored | mock_ingest |

## Heartbeat (one row)

| id | seen_at | active | build_sha |
| --- | --- | --- | --- |
| staging_mock_worker | 2026-10-26T11:37:27.502901+00:00 | 0 | 1c07c8507aa9049c6fe89c2f1c784fb2958084cf |

Every application belongs to the named test account (email not repeated in the evidence), every payload equals its sealed mock intent, all job retry counts are zero, and all application receipts are terminal and unchanged. The two watchdog orphan fixtures deliberately have no pg-boss application job. Four schedule jobs map one-to-one to the four durable schedule receipts.

