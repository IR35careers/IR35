import { z } from "zod";
import { resumeContainsTerm } from "@/lib/resume/analysis";

const segmenter = new Intl.Segmenter("en-GB", { granularity: "sentence" });
const limitSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const EXPERIENCE_EVIDENCE = /\b(?:built|delivered|operated|developed|implemented|designed|managed|migrated|configured|deployed|maintained|improved|led|supported|automated|used|using|worked|experience with|responsible for)\b/i;

function sentences(value: string): string[] {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split(/\r?\n/).flatMap(line => [...segmenter.segment(line.replace(/^\s*[•●◦▪‣*-]\s*/, ""))]
      .map(item => item.segment.replace(/\s+/g, " ").trim()).filter(Boolean));
}

function completeSentence(value: string): boolean {
  const balanced = (left: string, right: string) => [...value].filter(char => char === left).length ===
    [...value].filter(char => char === right).length;
  return /[.!?]["”’')\]]*$/.test(value) && balanced("(", ")") && balanced("[", "]");
}

/** Keep a whole answer, or a prefix of complete sentences. Never clip a word or parenthesis. */
export function fitAnswerToLimit(value: string, maximum: number): string {
  const limit = limitSchema.safeParse(maximum);
  if (!limit.success) return "";
  const clean = value.trim();
  if (clean.length <= limit.data) return clean;
  const result: string[] = [];
  for (const sentence of sentences(clean)) {
    if (!completeSentence(sentence) || [...result, sentence].join(" ").length > limit.data) break;
    result.push(sentence);
  }
  return result.join(" ");
}

/** Each skill question gets its own evidenced sentence, not the shared first CV line. */
export function evidenceForSkillQuestion(cvText: string, skill: string, maximum = 800): string {
  for (const sentence of sentences(cvText)) {
    if (sentence.length < 20 || !EXPERIENCE_EVIDENCE.test(sentence) || !resumeContainsTerm(sentence, skill)) continue;
    const answer = fitAnswerToLimit(sentence, maximum);
    if (answer && resumeContainsTerm(answer, skill)) return answer;
  }
  return "";
}
