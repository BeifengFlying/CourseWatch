import type { StudyQuestion } from '../../contracts/src/study.js';

export const unipusQuestionSelector = '.question-common-abs-choice,.question-common-abs-fill-blank,.uls-sc__question,.question-abs-question,.question-wrap,.question-container,.question-item,.question[data-question-id]';
export const unipusChoiceSelector = '[role="radio"],[role="checkbox"],.uls-sc__option[role="button"],.option-wrap > .option';

// Keep this callback self-contained for both tsx development and packaged workers.
export function unipusQuestionSnapshot({questionSelector,choiceSelector}: {questionSelector:string;choiceSelector:string}): StudyQuestion[] {
  const {visible, text} = {
    visible(node: Element) {
      return !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden' && !node.closest('[hidden],[aria-hidden=true]');
    },
    text(node?: Element | null) {
      if (!node) return '';
      const copy = node.cloneNode(true) as Element;
      copy.querySelectorAll('input[type=radio],input[type=checkbox]').forEach(field => field.remove());
      copy.querySelectorAll('input,textarea,select').forEach(field => field.replaceWith(' ___ '));
      copy.querySelectorAll('button,script,style,.question-reply-analysis,.analysis-item').forEach(node => node.remove());
      return (copy.textContent || '').replace(/\s+/g,' ').trim();
    },
  };
  const candidates = [...document.querySelectorAll(questionSelector)].filter(visible);
  const roots = candidates.filter(node => !candidates.some(other => other !== node && node.contains(other)));
  // Old markers must not survive a re-render or a change in the visible subset.
  document.querySelectorAll('[data-coursewatch-unipus-question]').forEach(node => node.removeAttribute('data-coursewatch-unipus-question'));
  return roots.flatMap(root => {
    const native = [...root.querySelectorAll<HTMLInputElement>('input[type="radio"],input[type="checkbox"]')].filter(node => !node.disabled);
    const custom = [...root.querySelectorAll(choiceSelector)].filter(node => visible(node) && node.getAttribute('aria-disabled') !== 'true');
    const choices = native.length ? native : custom;
    const fields = [...root.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('textarea,input[type="text"],input:not([type])')].filter(node => visible(node) && !node.disabled && !node.readOnly);
    // A quotation, video or reading article is not an exercise just because the
    // site wraps every activity in question-wrap / question-abs-question.
    if (!choices.length && !fields.length) return [];
    const headings = [...root.querySelectorAll('.question-stem,.question-title,.question-content,.stem,.ques-title,.uls-sc__stem-text,h3,h4')].filter(visible);
    let stem = headings.map(text).filter(Boolean).join('\n');
    if (!stem && root.matches('.question-common-abs-fill-blank')) stem = text(root);
    const activity = root.closest('.question-abs-question') || root;
    const material = activity.querySelector('.question-common-abs-material');
    const context = visible(material || activity) ? text(material) : '';
    if (context && !stem.includes(context)) stem = [context,stem].filter(Boolean).join('\n');
    // Inline blank layouts carry the sentence around the input itself.
    if (!stem && fields.length && !choices.length) stem = text(root);
    const options = choices.map(input => {
      if (input instanceof HTMLInputElement) return text(input.labels?.[0] || input.closest('label,.option,li')) || input.getAttribute('aria-label') || '';
      return text(input.querySelector('.uls-sc__option-text,.content') || input) || input.getAttribute('aria-label') || '';
    });
    const multiple = native.some(node => node.type === 'checkbox') || custom.some(node => node.getAttribute('role') === 'checkbox') || root.matches('.multipleChoice');
    const judge = !!root.closest('.question-u-listen-speak-judgment-pc') || /判断/.test(stem);
    const type: StudyQuestion['type'] = choices.length ? multiple ? 'multiple' : judge ? 'judge' : 'single' : fields.length > 1 || root.matches('.question-common-abs-fill-blank') || /填空/.test(stem) ? 'blank' : 'text';
    return [{id:root.getAttribute('data-question-id') || root.id || '',stem:stem.slice(0,16000),options,type,slots:choices.length ? 1 : fields.length,root}];
  }).map(({root,...question},index) => {
    root.setAttribute('data-coursewatch-unipus-question',String(index));
    return {...question,id:question.id || String(index)};
  });
}
