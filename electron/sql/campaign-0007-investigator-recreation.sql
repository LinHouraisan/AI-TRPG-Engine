CREATE TABLE investigator_recreation_branches (
  branch_id TEXT PRIMARY KEY REFERENCES branches(branch_id) DEFERRABLE INITIALLY DEFERRED,
  source_branch_id TEXT NOT NULL REFERENCES branches(branch_id),
  checkpoint_id TEXT NOT NULL REFERENCES checkpoints(checkpoint_id),
  created_at TEXT NOT NULL
) STRICT;

DROP TRIGGER branches_inherit_investigator;

CREATE TRIGGER branches_inherit_investigator AFTER INSERT ON branches
WHEN NEW.parent_branch_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM investigator_recreation_branches recreation
   WHERE recreation.branch_id = NEW.branch_id
 )
BEGIN
  INSERT INTO branch_investigator_bindings (branch_id, profile_id)
  SELECT NEW.branch_id, profile_id
  FROM branch_investigator_bindings
  WHERE branch_id = NEW.parent_branch_id;
END;
