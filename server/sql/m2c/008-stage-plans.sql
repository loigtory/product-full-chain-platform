-- Stage baseline plans: owner-confirmed execution baseline per stage.
-- The frozen plan is a stage-level contract (workspace, allowed files/commands, limits, validity);
-- turn-level jobs reference it via job.input.control. Review compares current workspace against the frozen baseline snapshot.
CREATE TABLE stage_plans (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL, req_id uuid NOT NULL,
 stage text NOT NULL CHECK(stage IN ('idea','req','design','dev','test','accept','release')),
 workspace text NOT NULL CHECK(length(workspace) BETWEEN 1 AND 1000),
 control jsonb NOT NULL CHECK(jsonb_typeof(control)='object' AND octet_length(control::text)<=1048576),
 baseline_hash text NOT NULL CHECK(baseline_hash ~ '^[a-f0-9]{64}$'),
 baseline_snapshot jsonb NOT NULL CHECK(jsonb_typeof(baseline_snapshot)='object' AND octet_length(baseline_snapshot::text)<=524288),
 state text NOT NULL DEFAULT 'frozen' CHECK(state IN ('frozen','revoked')),
 review jsonb CHECK(jsonb_typeof(review)='object' AND octet_length(review::text)<=524288),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 revoked_by uuid, revoked_at timestamptz,
 UNIQUE(tenant_id,req_id,stage),
 FOREIGN KEY(tenant_id,req_id) REFERENCES reqs(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES members(tenant_id,id),
 FOREIGN KEY(tenant_id,revoked_by) REFERENCES members(tenant_id,id),
 CHECK((state='revoked')=(revoked_at IS NOT NULL)),
 CHECK((state='revoked')=(revoked_by IS NOT NULL)),
 CHECK((state='frozen')=(revoked_at IS NULL)),
 CHECK((state='frozen')=(revoked_by IS NULL)));

-- 契约字段（workspace/control/baseline）在冻结后不可变；复核通过并撤权后可重新冻结（新周期）。
CREATE OR REPLACE FUNCTION stage_plans_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'STAGE_PLANS_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF NOT (OLD.state='revoked' AND NEW.state='frozen') AND
    (to_jsonb(NEW)-ARRAY['state','review','revoked_by','revoked_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['state','review','revoked_by','revoked_at'])
 THEN RAISE EXCEPTION 'STAGE_PLAN_INPUT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF OLD.state='revoked' AND NEW.state='frozen' THEN RETURN NEW; END IF;
 IF OLD.state='revoked' AND NEW.state IS DISTINCT FROM OLD.state
 THEN RAISE EXCEPTION 'STAGE_PLAN_TERMINAL' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER stage_plans_guard BEFORE UPDATE OR DELETE ON stage_plans FOR EACH ROW EXECUTE FUNCTION stage_plans_guard();
