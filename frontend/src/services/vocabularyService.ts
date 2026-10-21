import { invoke } from '@tauri-apps/api/core';
export interface SubstitutionRule {find:string;replace:string;wholeWord:boolean;caseSensitive:boolean;enabled:boolean}
let saves:Promise<unknown>=Promise.resolve();
export const vocabularyService={
  async list(){await saves.catch(()=>{});return invoke<SubstitutionRule[]>('substitutions_list');},
  save(rules:SubstitutionRule[]){const snapshot=rules.map(rule=>({...rule}));const request=saves.catch(()=>{}).then(()=>invoke<void>('substitutions_save',{rules:snapshot}));saves=request;return request;},
  path:()=>invoke<string>('substitutions_file_path'),
  test:(text:string)=>invoke<string>('substitutions_test',{text}),
};
