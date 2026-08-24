CREATE TABLE investigator_profiles (
  profile_id TEXT PRIMARY KEY,
  profile_json TEXT NOT NULL CHECK(json_valid(profile_json)),
  profile_hash TEXT NOT NULL,
  content_version TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE branch_investigator_bindings (
  branch_id TEXT PRIMARY KEY REFERENCES branches(branch_id),
  profile_id TEXT NOT NULL REFERENCES investigator_profiles(profile_id)
) STRICT;

CREATE TRIGGER investigator_profiles_no_update BEFORE UPDATE ON investigator_profiles
BEGIN
  SELECT RAISE(ABORT, 'investigator profiles are immutable');
END;

CREATE TRIGGER investigator_profiles_no_delete BEFORE DELETE ON investigator_profiles
BEGIN
  SELECT RAISE(ABORT, 'investigator profiles are immutable');
END;

CREATE TRIGGER branch_investigator_bindings_no_update BEFORE UPDATE ON branch_investigator_bindings
BEGIN
  SELECT RAISE(ABORT, 'investigator bindings are immutable');
END;

CREATE TRIGGER branch_investigator_bindings_no_delete BEFORE DELETE ON branch_investigator_bindings
BEGIN
  SELECT RAISE(ABORT, 'investigator bindings are immutable');
END;

CREATE TRIGGER branch_investigator_bindings_unstarted BEFORE INSERT ON branch_investigator_bindings
WHEN EXISTS (SELECT 1 FROM turns WHERE branch_id = NEW.branch_id)
BEGIN
  SELECT RAISE(ABORT, 'investigator branch already started');
END;

CREATE TRIGGER branches_inherit_investigator AFTER INSERT ON branches
WHEN NEW.parent_branch_id IS NOT NULL
BEGIN
  INSERT INTO branch_investigator_bindings (branch_id, profile_id)
  SELECT NEW.branch_id, profile_id
  FROM branch_investigator_bindings
  WHERE branch_id = NEW.parent_branch_id;
END;
