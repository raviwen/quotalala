const policyPattern = /blocked by policy|denied by policy|policy.*(?:reject|block)|permission denied|access denied|erişim.*engell|eriş.*redded/i;
const inabilityPattern = /(?:inceleme|incelemeyi|inceley|dosya|klasör|kaynak).{0,100}(?:yapılamadı|gerçekleştirilemedi|tamamlanamadı|okunamadı|okuyamad|erişilemedi|erişemedi|engell)|(?:could not|cannot|unable to).{0,60}(?:inspect|review|read|access)/i;
function requiresFileEvidence(task) {
  if (task.requiresFileEvidence === true) return true;
  const text = `${task.title || ''} ${task.prompt || ''}`;
  if (/\bwhat (?:is|are)\b|\bdefine\b|nedir|ne demek|kavram|concept/i.test(text)) return false;
  return /incel|review|audit/i.test(text) && /proje|klasör|dosya|kaynak|kod|repo|source|codebase/i.test(text);
}
function collectEvidence(result) {
  return { fileReferences: (result.stdout || '').match(/(?:[\w./\\-]+\.[a-zA-Z0-9]+):\d+(?::\d+)?/g) || [],
    executedChecks: (result.executedChecks || []).map(item => ({ command: item.command, exitCode: item.exitCode })),
    toolFailures: result.toolFailures || [], verifiedStatus: 'unverified',
    limitations: ['Agent output is a claim. File references do not prove correctness; synthesis is not an independent test.'] };
}
function evaluateTask(result, options = {}) {
  const output = result.stdout || '';
  const failures = result.toolFailures || [];
  const denied = failures.some(item => item.policyBlocked) || policyPattern.test(output) && inabilityPattern.test(output);
  const references = output.match(/(?:[\w./\\-]+\.[a-zA-Z0-9]+):\d+(?::\d+)?/g) || [];
  const hasReadEvidence = result.toolChecksAvailable !== true || (result.successfulFileCommands || 0) > 0;
  // A failed first attempt may be followed by a successful read and a grounded report.
  if (denied && !(options.requiresFileEvidence && references.length && hasReadEvidence && !inabilityPattern.test(output))) return { status: 'blocked', cause: 'policy' };
  if (options.requiresFileEvidence && (!references.length || !hasReadEvidence)) return { status: 'failed', cause: 'missing_evidence' };
  if (!output.trim()) return { status: 'failed', cause: 'empty_output' };
  if (inabilityPattern.test(output) || /(?:task|işlem|görev).{0,30}(?:failed|başarısız|tamamlanamadı)/i.test(output)) return { status: 'failed', cause: 'reported_failure' };
  return { status: 'completed', cause: null, evidence: collectEvidence(result) };
}
module.exports = { evaluateTask, requiresFileEvidence, collectEvidence, policyPattern };
