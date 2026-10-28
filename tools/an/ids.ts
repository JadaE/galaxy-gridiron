// Real Sleeper ids for the analysis scripts come from the gitignored app/config.local.json.
import { readFileSync } from 'fs';
import { join } from 'path';
const S = JSON.parse(readFileSync(join(__dirname, '../../app/config.local.json'), 'utf8')).sleeper;
export const UID: string = S.userId, MG: string = S.leagues.mg, FS: string = S.leagues.fs;
