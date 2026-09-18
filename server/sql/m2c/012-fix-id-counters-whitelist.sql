-- 67 号修复：011 重建 id_counters 实体白名单时漏掉了 005 已注册的测试验收域实体，
-- 导致 test_suites/delivery_baselines 等分配 ID 时违反 id_counters_entity_check。
-- 012 显式补齐完整白名单（005 清单 + 011 的 design_artifacts），纯约束修复，不触碰数据。
ALTER TABLE id_counters DROP CONSTRAINT id_counters_entity_check;
ALTER TABLE id_counters ADD CONSTRAINT id_counters_entity_check CHECK(entity IN
 ('reqs','req_versions','audit_logs','questions','materials','material_versions','file_objects','messages','runs','run_plans','notices','domain_events','req_version_reviews','replays','quality_gates','leases','message_references','members','caps','projects','knowledge',
 'artifact_versions','artifact_groups','artifact_group_sources','artifact_proposals','artifact_confirmations','artifact_impacts','design_artifacts',
 'test_suites','test_cases','delivery_baselines','test_batches','test_results','defects','defect_events','product_acceptances','verification_refs'));
