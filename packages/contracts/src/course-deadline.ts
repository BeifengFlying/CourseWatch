// Keep the precision supplied by the platform; a date without a time stays a date.
export function courseDeadline(value: unknown): string | null {
 if(typeof value!=='string')return null;
 const m=value.trim().match(/^(20\d{2})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
 if(!m)return null;
 const [year,month,day]=m.slice(1,4).map(Number),date=new Date(Date.UTC(year,month-1,day));
 if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day||Number(m[4]||0)>23||Number(m[5]||0)>59||Number(m[6]||0)>59)return null;
 return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`+(m[4]?` ${m[4].padStart(2,'0')}:${m[5]}${m[6]?':'+m[6]:''}`:'');
}
