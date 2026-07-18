/**
 * Skills Extractor
 *
 * Matches a controlled vocabulary of ~90 canonical skills against job title +
 * description. Design points:
 *
 * - Word-boundary regexes prevent substring false positives ("java" must not
 *   match inside "javascript" — ordering + boundaries handle this).
 * - Case-sensitive special cases for dangerously short names: "Go" only
 *   matches capitalized or as "Golang"; bare "R" and "C" are excluded
 *   entirely (too many false positives) — only "C++", "C#", "R programming"
 *   style variants count.
 * - All patterns are compiled once at module load; extraction is a single
 *   pass, well under 1ms per job.
 */

interface SkillDef {
  canonical: string;
  /** Regex source strings (compiled with 'i' unless caseSensitive). */
  variants: string[];
  caseSensitive?: boolean;
}

const B = (s: string) => String.raw`\b${s}\b`;

const SKILL_DEFS: SkillDef[] = [
  // Languages
  { canonical: "JavaScript", variants: [B("javascript"), B("js")] },
  { canonical: "TypeScript", variants: [B("typescript"), B("ts")] },
  { canonical: "Python", variants: [B("python")] },
  { canonical: "Java", variants: [String.raw`\bjava\b(?!\s*script)`] },
  { canonical: "C#", variants: [String.raw`\bc#`, B("csharp"), String.raw`\bc\s?sharp\b`] },
  { canonical: "C++", variants: [String.raw`\bc\+\+`, B("cpp")] },
  { canonical: "Go", variants: [String.raw`\bGo\b`, String.raw`\b[Gg]olang\b`], caseSensitive: true },
  { canonical: "Rust", variants: [B("rust")] },
  { canonical: "PHP", variants: [B("php")] },
  { canonical: "Ruby", variants: [B("ruby")] },
  { canonical: "Scala", variants: [B("scala")] },
  { canonical: "Kotlin", variants: [B("kotlin")] },
  { canonical: "Swift", variants: [B("swift")] },
  { canonical: "R", variants: [String.raw`\bR\s+programming\b`, B("rstudio")] },
  { canonical: "SQL", variants: [B("sql")] },
  // Frontend
  { canonical: "React", variants: [String.raw`\breact(\.?js)?\b(?!\s*native)`] },
  { canonical: "React Native", variants: [String.raw`\breact\s*native\b`] },
  { canonical: "Angular", variants: [B("angular")] },
  { canonical: "Vue", variants: [String.raw`\bvue(\.?js)?\b`] },
  { canonical: "Next.js", variants: [String.raw`\bnext\.?js\b`] },
  { canonical: "Svelte", variants: [B("svelte")] },
  { canonical: "Redux", variants: [B("redux")] },
  { canonical: "HTML", variants: [B("html5?")] },
  { canonical: "CSS", variants: [B("css3?"), B("tailwind"), B("sass"), B("scss")] },
  // Backend / frameworks
  { canonical: "Node.js", variants: [String.raw`\bnode(\.?js)?\b`] },
  { canonical: ".NET", variants: [String.raw`\.net\b`, B("dotnet"), String.raw`\basp\.net\b`] },
  { canonical: "Spring Boot", variants: [String.raw`\bspring\s*(boot)?\b`] },
  { canonical: "Django", variants: [B("django")] },
  { canonical: "Flask", variants: [B("flask")] },
  { canonical: "FastAPI", variants: [B("fastapi")] },
  { canonical: "Ruby on Rails", variants: [String.raw`\b(ruby\s+on\s+)?rails\b`] },
  { canonical: "Laravel", variants: [B("laravel")] },
  { canonical: "GraphQL", variants: [B("graphql")] },
  { canonical: "REST API", variants: [String.raw`\brest(ful)?\s*api`, String.raw`\brest\b`] },
  { canonical: "Microservices", variants: [String.raw`\bmicro\s*-?services?\b`] },
  // Cloud
  { canonical: "AWS", variants: [B("aws"), String.raw`\bamazon\s+web\s+services\b`] },
  { canonical: "Azure", variants: [B("azure")] },
  { canonical: "GCP", variants: [B("gcp"), String.raw`\bgoogle\s+cloud\b`] },
  { canonical: "Serverless", variants: [B("serverless"), B("lambda")] },
  // DevOps / infra
  { canonical: "Kubernetes", variants: [B("kubernetes"), B("k8s")] },
  { canonical: "Docker", variants: [B("docker")] },
  { canonical: "Terraform", variants: [B("terraform")] },
  { canonical: "Ansible", variants: [B("ansible")] },
  { canonical: "Jenkins", variants: [B("jenkins")] },
  { canonical: "GitHub Actions", variants: [String.raw`\bgithub\s+actions\b`] },
  { canonical: "GitLab CI", variants: [String.raw`\bgitlab(\s+ci)?\b`] },
  { canonical: "CI/CD", variants: [String.raw`\bci\s*/?\s*cd\b`, String.raw`\bcontinuous\s+(integration|delivery|deployment)\b`] },
  { canonical: "Linux", variants: [B("linux"), B("unix")] },
  { canonical: "Bash", variants: [B("bash"), String.raw`\bshell\s+script`] },
  { canonical: "PowerShell", variants: [B("powershell")] },
  { canonical: "DevOps", variants: [B("devops")] },
  { canonical: "SRE", variants: [B("sre"), String.raw`\bsite\s+reliability\b`] },
  // Databases / data
  { canonical: "PostgreSQL", variants: [B("postgres(ql)?")] },
  { canonical: "MySQL", variants: [B("mysql")] },
  { canonical: "SQL Server", variants: [String.raw`\bsql\s+server\b`, B("t-sql"), B("tsql")] },
  { canonical: "MongoDB", variants: [B("mongo(db)?")] },
  { canonical: "Redis", variants: [B("redis")] },
  { canonical: "Elasticsearch", variants: [B("elastic\\s?search"), B("opensearch")] },
  { canonical: "Kafka", variants: [B("kafka")] },
  { canonical: "RabbitMQ", variants: [B("rabbitmq")] },
  { canonical: "Snowflake", variants: [B("snowflake")] },
  { canonical: "Databricks", variants: [B("databricks")] },
  { canonical: "Spark", variants: [B("spark"), B("pyspark")] },
  { canonical: "Airflow", variants: [B("airflow")] },
  { canonical: "dbt", variants: [B("dbt")] },
  { canonical: "Power BI", variants: [String.raw`\bpower\s*bi\b`] },
  { canonical: "Tableau", variants: [B("tableau")] },
  { canonical: "Data Engineering", variants: [String.raw`\bdata\s+engineer(ing)?\b`, String.raw`\betl\b`] },
  { canonical: "Machine Learning", variants: [String.raw`\bmachine\s+learning\b`, B("ml\\s+engineer"), B("deep\\s+learning")] },
  { canonical: "Data Science", variants: [String.raw`\bdata\s+scien(ce|tist)\b`] },
  { canonical: "AI/LLM", variants: [String.raw`\b(gen(erative)?\s*ai|llms?|large\s+language\s+models?|openai|anthropic)\b`, String.raw`\bAI\b`] },
  { canonical: "NLP", variants: [B("nlp"), String.raw`\bnatural\s+language\s+processing\b`] },
  // Testing
  { canonical: "Cypress", variants: [B("cypress")] },
  { canonical: "Playwright", variants: [B("playwright")] },
  { canonical: "Selenium", variants: [B("selenium")] },
  { canonical: "Jest", variants: [B("jest")] },
  { canonical: "QA/Testing", variants: [String.raw`\bqa\b`, String.raw`\btest\s+automation\b`, String.raw`\bautomation\s+test`] },
  // Security / clearance
  { canonical: "Cyber Security", variants: [String.raw`\bcyber\s*-?security\b`, String.raw`\binfosec\b`, String.raw`\binformation\s+security\b`] },
  { canonical: "Penetration Testing", variants: [String.raw`\bpen(etration)?\s*test`] },
  { canonical: "SC Cleared", variants: [String.raw`\bsc\s*clear(ed|ance)\b`, String.raw`\bsecurity\s+clear(ed|ance)\b`] },
  { canonical: "DV Cleared", variants: [String.raw`\bdv\s*clear(ed|ance)\b`, String.raw`\bdeveloped\s+vetting\b`] },
  // Enterprise platforms
  { canonical: "Salesforce", variants: [B("salesforce")] },
  { canonical: "SAP", variants: [B("sap")] },
  { canonical: "Dynamics 365", variants: [String.raw`\bdynamics\s*(365)?\b`] },
  { canonical: "ServiceNow", variants: [B("servicenow")] },
  { canonical: "Workday", variants: [B("workday")] },
  // Mobile
  { canonical: "iOS", variants: [B("ios")] },
  { canonical: "Android", variants: [B("android")] },
  { canonical: "Flutter", variants: [B("flutter")] },
  // Delivery / management
  { canonical: "Agile", variants: [B("agile"), B("scrum"), B("kanban")] },
  { canonical: "Jira", variants: [B("jira")] },
  { canonical: "Project Management", variants: [String.raw`\bproject\s+manager?(ment)?\b`, B("prince2"), B("pmp")] },
  { canonical: "Product Management", variants: [String.raw`\bproduct\s+(manager|owner|management)\b`] },
  { canonical: "Business Analysis", variants: [String.raw`\bbusiness\s+analys(t|is)\b`] },
  { canonical: "Solutions Architecture", variants: [String.raw`\b(solutions?|technical|enterprise)\s+architect`] },
  { canonical: "Figma", variants: [B("figma")] },
];

interface CompiledSkill {
  canonical: string;
  regexes: RegExp[];
}

const COMPILED: CompiledSkill[] = SKILL_DEFS.map((def) => ({
  canonical: def.canonical,
  regexes: def.variants.map((v) => new RegExp(v, def.caseSensitive ? "" : "i")),
}));

/**
 * Extract canonical skills present in the given text(s).
 * Returns a de-duplicated array in dictionary order.
 */
export function extractSkills(title: string, description: string): string[] {
  const text = `${title ?? ""} ${description ?? ""}`;
  const found: string[] = [];
  for (const skill of COMPILED) {
    if (skill.regexes.some((re) => re.test(text))) {
      found.push(skill.canonical);
    }
  }
  return found;
}
