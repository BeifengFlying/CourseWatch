import type { StudyChapter } from './chapter-directory.js';

// Serialized into the official page. Read only the menu's rendered structure
// and its own React view data; never invoke application methods or edit state.
export function unipusDirectorySnapshot(nodes: Element[]): StudyChapter[] {
  const {clean, label, plain, identifier} = {
    clean(value?: string | null) { return (value || '').replace(/\s+/g, ' ').trim(); },
    label(node: Element) {
      const name = node.querySelector('.pc-menu-node-name,.pc-menu-node-text,.unit-label-item') || node;
      return ((node.matches('.pc-slider-menu-unit') ? name.textContent : name.getAttribute('title') || name.textContent) || '').replace(/\s+/g, ' ').trim().slice(0,300);
    },
    plain(value: unknown) {
      return typeof value === 'string' ? (new DOMParser().parseFromString(value,'text/html').body.textContent || '').replace(/\s+/g,' ').trim().slice(0,300) : '';
    },
    identifier(value: unknown) { return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : ''; },
  };
  const menu = nodes[0]?.closest('.pc-slider-content-menu');
  const leaves = nodes.filter(row => !row.querySelector('.pc-slider-menu-micro,.pc-slider-menu-node'));
  // The site does not put resource IDs or required flags on menu rows. Its menu
  // component holds the same course tree and official unit progress it renders.
  // Use it only if the entire displayed leaf sequence matches that tree.
  const native: {id:string;name:string;path:{id:string;name:string}[];required:boolean|null;complete:boolean|null}[] = [];
  if (menu) {
    const key = Object.keys(menu).find(key => key.startsWith('__reactFiber$'));
    let fiber = key ? (menu as any)[key] : undefined;
    for (let depth = 0; fiber && depth < 20; depth++, fiber = fiber.return) {
      const props = fiber.memoizedProps, state = fiber.stateNode?.state || fiber.memoizedState;
      const units = props?.course?.rootNode?.children;
      if (!Array.isArray(units) || !Array.isArray(state?.unitProgressData)) continue;
      for (const unit of units.slice(0,100)) {
        const unitId = identifier(unit?.id), unitName = clean([plain(unit?.caption),plain(unit?.name)].filter(Boolean).join(' '));
        if (!unitId || !unitName || !Array.isArray(unit.children)) continue;
        const progress = state.unitProgressData.find((value: any) => value?.unit_id === unitId);
        for (const branch of unit.children.slice(0,400)) {
          const branchId = identifier(branch?.id), branchName = plain(branch?.name);
          if (!branchId || !branchName) continue;
          const entries = branch.category === 'section' ? branch.children : [branch];
          if (!Array.isArray(entries)) continue;
          for (const entry of entries.slice(0,400)) {
            const id = identifier(entry?.id), name = plain(entry?.name);
            if (!id || !name) continue;
            const path = [{id:unitId,name:unitName},...(branch.category === 'section' ? [{id:branchId,name:branchName}] : [])];
            const record = entry.category === 'group' ? progress?.leafs?.[id] : progress?.micros?.[`${unitId}/${id}`];
            const pass = record?.state?.pass;
            const requirements: unknown[] = [];
            const queue = [entry];
            // Required is a leaf strategy. Aggregate only a complete known set.
            for (let n = 0; queue.length && n < 1000; n++) {
              const child = queue.shift();
              if (Array.isArray(child?.children) && child.children.length) queue.push(...child.children);
              else requirements.push(progress?.leafs?.[identifier(child?.id)]?.strategies?.required);
            }
            const declaredRequirement = record?.strategies?.required;
            const required = declaredRequirement === true || declaredRequirement === 1 ? true
              : declaredRequirement === false || declaredRequirement === 0 ? false
              : requirements.some(value => value === true || value === 1) ? true
              : !queue.length && requirements.length > 0 && requirements.every(value => value === false || value === 0) ? false : null;
            native.push({id,name,path,required,complete:pass === 1 ? true : typeof pass === 'number' && pass >= 0 && pass < 1 ? false : null});
          }
        }
      }
      break;
    }
  }
  const matched = native.length === leaves.length && native.every((entry,index) => {
    const row = leaves[index];
    if (entry.name !== label(row)) return false;
    const unit = row.closest('.pc-slider-content-menu > div')?.querySelector(':scope > .pc-slider-menu-unit');
    if (unit && label(unit) !== entry.path[0].name) return false;
    let section: Element | null = null;
    for (let parent = row.parentElement; parent && parent !== menu; parent = parent.parentElement) {
      section = parent.querySelector(':scope > .pc-slider-menu-section');
      if (section || parent.querySelector(':scope > .pc-slider-menu-unit')) break;
    }
    return entry.path.length === 2 ? !!section && label(section) === entry.path[1].name : !section;
  });
  return leaves.flatMap((row,index) => {
    const name = label(row);
    if (!name) return [];
    const originalIndex = nodes.indexOf(row), metadata = matched ? native[index] : undefined;
    const path: {id:string;name:string}[] = metadata?.path || [];
    if (!metadata) {
      // Modern menus group siblings in anonymous unit/section wrappers.
      const group = row.closest('.pc-slider-content-menu > div');
      const unit = group?.querySelector(':scope > .pc-slider-menu-unit');
      let section: Element | null = null;
      for (let parent = row.parentElement; parent && parent !== group && parent !== menu; parent = parent.parentElement) {
        section = parent.querySelector(':scope > .pc-slider-menu-section');
        if (section) break;
      }
      for (const parent of [unit,section]) if (parent) {
        const name = label(parent), ordinal = [...menu!.querySelectorAll('.pc-slider-menu-unit,.pc-slider-menu-section')].indexOf(parent);
        if (name) path.push({id:parent.getAttribute('data-id') || `group:${ordinal}:${name}`.slice(0,200),name});
      }
      // Retain compatibility with nested directories and folded sections.
      for (let parent = row.parentElement?.closest('.pc-slider-menu-node'); parent; parent = parent.parentElement?.closest('.pc-slider-menu-node') || null) {
        const own = parent.cloneNode(true) as Element;
        own.querySelectorAll('.pc-slider-menu-micro,.pc-slider-menu-node').forEach(node => node.remove());
        const name = label(own), id = parent.id || parent.getAttribute('data-id') || parent.getAttribute('data-node-id');
        if (name && id) path.unshift({id,name});
      }
    }
    const locked = !!row.closest('[disabled],[aria-disabled=true],.disabled,.locked,[data-locked=true],.pc-menu-micro-lock') || !!row.querySelector('.pc-menu-lock-icon,.lock,.icon-lock,[data-locked=true]');
    const finished = row.getAttribute('data-completed') === 'true' || !!row.querySelector('.pc-slider-menu-status-circle-all');
    const unfinished = row.getAttribute('data-completed') === 'false';
    const complete = finished && !unfinished ? true : unfinished && !finished ? false : metadata?.complete ?? null;
    const requiredValue = row.getAttribute('data-required');
    const required = requiredValue === 'true' ? true : requiredValue === 'false' ? false : metadata?.required ?? null;
    const id = row.id || row.getAttribute('data-id') || row.getAttribute('data-node-id') || metadata?.id || `item:${originalIndex}:${name}`.slice(0,200);
    return [{id,name,path,complete,required,locked,current:row.matches('.pc-menu-activity,.active,.current,[aria-current=page],[aria-selected=true]'),index:originalIndex}];
  });
}
