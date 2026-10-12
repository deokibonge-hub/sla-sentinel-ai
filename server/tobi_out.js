import { callSystem } from './trust.js';
// Outbound TOBi messaging helpers (shared by case engine & lifecycle without circular imports).
import { get, run, s } from './db.js';
import { iso } from './core.js';

export function tobiSay(conv_id, content, kind = 'text', meta = null) {
  run('INSERT INTO messages(conv_id,sender,kind,content,meta,created_at) VALUES(?,?,?,?,?,?)', conv_id, 'tobi', kind, content, s(meta), iso());
  run('UPDATE conversations SET updated_at=? WHERE id=?', iso(), conv_id);
  callSystem('TOBI', 'conversation.write', { detail: kind });
}
export function convForApplication(app_id) { return get('SELECT * FROM conversations WHERE application_id=? ORDER BY id DESC', app_id); }
export function convForMsisdn(msisdn) { return get('SELECT * FROM conversations WHERE msisdn=? ORDER BY id DESC', msisdn); }
