export interface VerifyCase {
  id: string;
  state: string;
  questions: {
    key: string;
    type: "choice" | "score" | "noul";
    instructions: string;
    criteria?: Record<string, string> | string[];
    expected: string | number | boolean;
  }[];
}
export const VERIFY_CASES: VerifyCase[];
