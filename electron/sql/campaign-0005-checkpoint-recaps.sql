CREATE TABLE checkpoint_recaps (
  checkpoint_id TEXT PRIMARY KEY REFERENCES checkpoints(checkpoint_id),
  recap TEXT NOT NULL CHECK(length(trim(recap)) > 0)
) STRICT;

INSERT INTO checkpoint_recaps (checkpoint_id, recap)
SELECT
  c.checkpoint_id,
  trim(
    COALESCE(
      json_extract(p.profile_json, '$.name') || '因沈鹭寄来的车票来到雾港站。',
      '海雾漫过钟楼时，雾港站只剩最后一班列车。'
    ) || ' ' ||
    COALESCE(
      CASE json_extract(p.profile_json, '$.lifeHistoryId')
        WHEN 'history.archive-correspondent' THEN json_extract(p.profile_json, '$.name') || '曾替沈鹭誊抄潮汐支线的旧档案，最后一封信由你亲手寄出。'
        WHEN 'history.old-line-reporter' THEN json_extract(p.profile_json, '$.name') || '曾报道潮汐支线事故，也认识不肯放下姐姐的顾弦。'
        WHEN 'history.station-ledger' THEN json_extract(p.profile_json, '$.name') || '曾替雾港站整理账簿，知道罗姨最在意每一张票的去处。'
        WHEN 'history.tide-photographer' THEN json_extract(p.profile_json, '$.name') || '拍过那张站员合影，始终记得镜头边缘少算进去的一个孩子。'
      END,
      ''
    ) || ' ' ||
    COALESCE((
      SELECT group_concat(summary, ' ')
      FROM (
        SELECT json_extract(e.payload_json, '$.summary') AS summary
        FROM events e
        WHERE e.branch_id = c.branch_id
          AND e.sequence <= c.event_sequence
          AND json_extract(e.audience_json, '$.kind') = 'public'
        ORDER BY e.sequence
      )
    ), '')
  )
FROM checkpoints c
LEFT JOIN branch_investigator_bindings b ON b.branch_id = c.branch_id
LEFT JOIN investigator_profiles p ON p.profile_id = b.profile_id;

CREATE TABLE checkpoint_restore_sources (
  branch_id TEXT PRIMARY KEY REFERENCES branches(branch_id),
  checkpoint_id TEXT NOT NULL REFERENCES checkpoints(checkpoint_id)
) STRICT;
