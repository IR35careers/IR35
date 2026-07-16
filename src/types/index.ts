export interface Feature {
  icon: string;
  title: string;
  description: string;
}

export interface FAQItem {
  question: string;
  answer: string;
}

export interface TimelineItem {
  title: string;
  description: string;
  status: "completed" | "current" | "upcoming";
}
