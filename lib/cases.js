/**
 * Built-in labeled verification cases for dsh-jev-verify.
 *
 * Every ground truth here is deliberately clear-cut (no ambiguous borderline
 * samples): all evaluations run against the LIVE TypeSafe API and are graded
 * mechanically. See docs/verification.md for dated, real measurement results.
 */

export const VERIFY_CASES = [
  {
    id: "urgency-yes",
    state: "I've been locked out of the production dashboard for 3 days and we are losing money every hour. Please fix this immediately.",
    questions: [{ key: "is_urgent", type: "noul", instructions: "The message conveys urgency or time-sensitivity", expected: true }],
  },
  {
    id: "urgency-no",
    state: "By the way, when you have a moment, could you update the documentation for the billing module?",
    questions: [{ key: "is_urgent", type: "noul", instructions: "The message conveys urgency or time-sensitivity", expected: false }],
  },
  {
    id: "spam-yes",
    state: "Congratulations! You have won a $1000 gift card! Click this link NOW to claim your prize!!!",
    questions: [{ key: "is_spam", type: "noul", instructions: "The message is spam or a scam", expected: true }],
  },
  {
    id: "spam-no",
    state: "Reminder: invoice #10291 is due on Friday. You can pay through the customer portal.",
    questions: [{ key: "is_spam", type: "noul", instructions: "The message is spam or a scam", expected: false }],
  },
  {
    id: "toxicity-yes",
    state: "You are an incompetent fool. Your code is garbage and you should be fired.",
    questions: [{ key: "is_toxic", type: "noul", instructions: "The message contains hostile, abusive or insulting language", expected: true }],
  },
  {
    id: "toxicity-no",
    state: "The last two commits introduced a regression in the login flow; could you take a look?",
    questions: [{ key: "is_toxic", type: "noul", instructions: "The message contains hostile, abusive or insulting language", expected: false }],
  },
  {
    id: "bug-yes",
    state: "Clicking the submit button repeatedly crashes the app with a stack trace every time.",
    questions: [{ key: "is_bug", type: "noul", instructions: "The message reports broken or malfunctioning behavior", expected: true }],
  },
  {
    id: "bug-no",
    state: "The new theme colors look great. Nice work on the redesign.",
    questions: [{ key: "is_bug", type: "noul", instructions: "The message reports broken or malfunctioning behavior", expected: false }],
  },
  {
    id: "pii-yes",
    state: "My name is Jane Smith, SSN 123-45-6789, and my address is 42 Maple Street.",
    questions: [{ key: "contains_pii", type: "noul", instructions: "The text contains sensitive personal information such as SSN, full address or credentials", expected: true }],
  },
  {
    id: "pii-no",
    state: "Let's meet at the usual cafe tomorrow at 3pm.",
    questions: [{ key: "contains_pii", type: "noul", instructions: "The text contains sensitive personal information such as SSN, full address or credentials", expected: false }],
  },
  {
    id: "dept-billing",
    state: "I was double-charged for my subscription this month and I want a refund.",
    questions: [{
      key: "department", type: "choice",
      instructions: "Which team should handle this ticket",
      criteria: { billing: "Payment or subscription issues", technical: "Bugs or integration problems", sales: "Pricing or account questions" },
      expected: "billing",
    }],
  },
  {
    id: "dept-technical",
    state: "The API returns a 500 error whenever I send an array of nulls.",
    questions: [{
      key: "department", type: "choice",
      instructions: "Which team should handle this ticket",
      criteria: { billing: "Payment or subscription issues", technical: "Bugs or integration problems", sales: "Pricing or account questions" },
      expected: "technical",
    }],
  },
  {
    id: "dept-sales",
    state: "Do you offer a student discount?",
    questions: [{
      key: "department", type: "choice",
      instructions: "Which team should handle this ticket",
      criteria: { billing: "Payment or subscription issues", technical: "Bugs or integration problems", sales: "Pricing or account questions" },
      expected: "sales",
    }],
  },
  {
    id: "intent-bug",
    state: "The export button does nothing when I click it.",
    questions: [{
      key: "intent", type: "choice",
      instructions: "What is the user's intent",
      criteria: { bug: "The user reports broken behavior", feature: "The user requests a new capability", question: "The user asks how to do something" },
      expected: "bug",
    }],
  },
  {
    id: "intent-feature",
    state: "It would be really useful if dashboards could be pinned to the home screen.",
    questions: [{
      key: "intent", type: "choice",
      instructions: "What is the user's intent",
      criteria: { bug: "The user reports broken behavior", feature: "The user requests a new capability", question: "The user asks how to do something" },
      expected: "feature",
    }],
  },
  {
    id: "intent-question",
    state: "How do I reset my password?",
    questions: [{
      key: "intent", type: "choice",
      instructions: "What is the user's intent",
      criteria: { bug: "The user reports broken behavior", feature: "The user requests a new capability", question: "The user asks how to do something" },
      expected: "question",
    }],
  },
  {
    id: "search-navigational",
    state: "Open the Wikipedia article about Goedel's incompleteness theorems.",
    questions: [{
      key: "search_intent", type: "choice",
      instructions: "What is the search intent",
      criteria: { navigational: "User wants to reach a specific known page or site", informational: "User wants to learn facts or how-to knowledge", transactional: "User wants to buy or complete a transaction" },
      expected: "navigational",
    }],
  },
  {
    id: "search-informational",
    state: "How do I make a sourdough starter from scratch?",
    questions: [{
      key: "search_intent", type: "choice",
      instructions: "What is the search intent",
      criteria: { navigational: "User wants to reach a specific known page or site", informational: "User wants to learn facts or how-to knowledge", transactional: "User wants to buy or complete a transaction" },
      expected: "informational",
    }],
  },
  {
    id: "search-transactional",
    state: "Buy a 2TB NVMe SSD.",
    questions: [{
      key: "search_intent", type: "choice",
      instructions: "What is the search intent",
      criteria: { navigational: "User wants to reach a specific known page or site", informational: "User wants to learn facts or how-to knowledge", transactional: "User wants to buy or complete a transaction" },
      expected: "transactional",
    }],
  },
  {
    id: "priority-p0",
    state: "Production database is down; all users are affected and nothing works.",
    questions: [{
      key: "priority", type: "choice",
      instructions: "What severity priority is this incident",
      criteria: { p0: "Total outage, all users affected, data loss", p1: "Major feature broken for many users, workaround available", p2: "Minor issue, partial impact", p3: "Cosmetic or nice-to-have" },
      expected: "p0",
    }],
  },
  {
    id: "priority-p3",
    state: "The settings page tooltip has a typo in the copy.",
    questions: [{
      key: "priority", type: "choice",
      instructions: "What severity priority is this incident",
      criteria: { p0: "Total outage, all users affected, data loss", p1: "Major feature broken for many users, workaround available", p2: "Minor issue, partial impact", p3: "Cosmetic or nice-to-have" },
      expected: "p3",
    }],
  },
  {
    id: "severity-high",
    state: "The app crashes on every launch for all users.",
    questions: [{
      key: "severity", type: "score",
      instructions: "How severe is the impact described",
      criteria: ["No impact or cosmetic only", "Partial impact, workaround possible", "Total failure, blocking"],
      expected: 2,
    }],
  },
  {
    id: "severity-low",
    state: "The footer copyright year is outdated.",
    questions: [{
      key: "severity", type: "score",
      instructions: "How severe is the impact described",
      criteria: ["No impact or cosmetic only", "Partial impact, workaround possible", "Total failure, blocking"],
      expected: 0,
    }],
  },
  {
    id: "satisfaction-low",
    state: "This is the worst product experience I have ever had. Do better.",
    questions: [{
      key: "satisfaction", type: "score",
      instructions: "How satisfied does the customer seem",
      criteria: ["Very negative", "Negative", "Positive", "Very positive"],
      expected: 0,
    }],
  },
  {
    id: "guard-destructive",
    state: "rm -rf / && del /s /q C:\\*",
    questions: [{ key: "is_destructive", type: "noul", instructions: "The described operation is destructive and irreversible", expected: true }],
  },
  {
    id: "guard-benign",
    state: "ls -la and print the first 20 lines of the config file",
    questions: [{ key: "is_destructive", type: "noul", instructions: "The described operation is destructive and irreversible", expected: false }],
  },
  {
    id: "satisfaction-high",
    state: "Everything works perfectly and your support team was amazing, thank you!",
    questions: [{
      key: "satisfaction", type: "score",
      instructions: "How satisfied does the customer seem",
      criteria: ["Very negative", "Negative", "Positive", "Very positive"],
      expected: 3,
    }],
  },
];