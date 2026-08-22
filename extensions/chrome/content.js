(() => {
  if (window.__ir35CareersAssistantLoaded) return;
  window.__ir35CareersAssistantLoaded = true;

  const TOKEN_PATTERN = /(?:^|&)ir35careers-apply=([A-Za-z0-9_-]{40,60})(?:&|$)/;
  const SUCCESS = /(?:thank you for applying|application (?:has been )?(?:submitted|received|sent)|we (?:have )?received your application|application complete|successfully applied)/i;
  const CAPTCHA = 'iframe[src*="captcha" i], [id*="captcha" i], [class*="captcha" i], iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i]';
  const SENSITIVE = /(date of birth|birth date|national insurance|passport|social security|gender|sex|ethnic|race|religion|medical|health|veteran|current salary|signature)/i;
  const LEGAL = /(terms(?: and conditions)?|privacy|declaration|agreement|consent to|certif(?:y|ication)|acknowledge)/i;
  const PATTERNS = [
    ["first_name", /\b(first|given)\s*name\b/i], ["last_name", /\b(last|family|sur)\s*name\b/i],
    ["full_name", /\b(full|legal)\s*name\b|^name$/i], ["email", /e-?mail/i], ["phone", /phone|mobile|telephone/i],
    ["postcode", /post\s*code|postal\s*code|zip\s*code/i], ["address", /street|address\s*(line)?\s*1/i],
    ["city", /\bcity\b|town/i], ["county", /county|state|province|region/i], ["country", /country/i],
    ["linkedin", /linkedin/i], ["portfolio", /portfolio|personal\s*(site|website)|github|website/i],
    ["notice_period", /notice\s*period/i], ["availability", /availability|available\s*(from|to start)|start\s*date/i],
    ["needs_sponsorship", /sponsor|visa/i], ["right_to_work", /right\s*to\s*work|authori[sz]ed?\s*to\s*work|work\s*authori[sz]ation/i],
    ["can_relocate", /relocat/i], ["can_work_in_person", /work\s*(in person|on.?site)|on.?site/i],
    ["can_start_immediately", /start\s*immediately/i], ["education_institution", /university|college|institution|school/i],
    ["education_qualification", /degree|qualification/i], ["security_clearance", /security\s*clearance|clearance\s*level/i],
    ["limited_company_name", /limited\s*company|company\s*name/i], ["is_over_18", /(?:18|eighteen).*(?:older|over)|age.*(?:eligib|confirm)/i],
    ["has_transportation", /reliable\s*transport|own\s*transport|driving\s*licen[cs]e/i],
    ["needs_accommodation", /accommodation|workplace\s*adjustment|reasonable\s*adjustment/i],
    ["worked_for_company_before", /worked.*(?:company|us).*before|previously\s*(?:employed|worked)/i],
    ["has_government_clearance", /hold.*(?:government|security)\s*clearance/i], ["has_government_ties", /government.*(?:ties|employment|contract)/i],
    ["willing_to_travel", /willing.*travel|travel.*required/i], ["willing_to_work_shifts", /willing.*shift|shift\s*work/i],
    ["willing_to_work_weekends", /willing.*weekend|weekend\s*work/i], ["background_check_consent", /background\s*check|pre-employment\s*screen/i],
    ["criminal_convictions", /criminal|conviction/i], ["target_day_rate", /(?:expected|target|desired).*(?:day\s*rate|rate)|day\s*rate/i],
    ["target_annual_salary", /(?:expected|target|desired).*(?:annual\s*)?salary|salary\s*expectation/i],
    ["years_of_experience", /years?.*(?:experience|using|working)/i], ["referral_source", /how.*(?:hear|find).*(?:role|job|opportun)|source/i],
    ["location", /current\s*location|where\s*are\s*you\s*based/i],
  ];

  function clean(value, max = 500) {
    return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }
  function normalise(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  function visible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
  }
  function labelFor(element) {
    const labels = element.labels ? Array.from(element.labels).map((label) => label.textContent || "").join(" ") : "";
    const labelled = clean(element.getAttribute("aria-labelledby")).split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent || "").join(" ");
    const legend = element.closest("fieldset")?.querySelector("legend")?.textContent || "";
    return clean(legend || labelled || element.getAttribute("aria-label") || labels || element.getAttribute("placeholder") || element.getAttribute("name") || "Employer question");
  }
  function required(element) { return element.required || element.getAttribute("aria-required") === "true"; }
  function currentValue(element) {
    if (element instanceof HTMLSelectElement) return element.value ? (element.selectedOptions[0]?.textContent || element.value) : "";
    if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) return element.checked ? (labelFor(element) || element.value) : "";
    return element.value || "";
  }
  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(element, value); else element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }
  function closestOption(value, options) {
    const target = normalise(value);
    const exact = options.find((option) => normalise(option.label) === target || normalise(option.value) === target);
    if (exact) return exact;
    if (target === "yes") return options.find((option) => /^(yes|true|authori[sz]ed|i agree)$/i.test(clean(option.label || option.value)));
    if (target === "no") return options.find((option) => /^(no|false|not required|i do not agree)$/i.test(clean(option.label || option.value)));
    return options.find((option) => normalise(option.label).includes(target) || target.includes(normalise(option.label)));
  }
  function screeningAnswer(label, answers) {
    const target = normalise(label);
    const exact = answers.find((item) => item.reviewed && normalise(item.label) === target && clean(item.answer));
    if (exact) return clean(exact.answer, 2000);
    const near = answers.find((item) => {
      const candidate = normalise(item.label);
      return item.reviewed && clean(item.answer) && candidate.length >= 12 && (candidate.includes(target) || target.includes(candidate));
    });
    return near ? clean(near.answer, 2000) : "";
  }
  function factFor(label, packet) {
    if (SENSITIVE.test(label)) return "";
    const mapping = PATTERNS.find(([, pattern]) => pattern.test(label));
    if (mapping) return clean(packet.facts.values[mapping[0]], 4000);
    return screeningAnswer(label, packet.facts.screeningAnswers || []);
  }
  function action(pattern) {
    const elements = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a[role="button"], a'));
    return elements.find((element) => {
      if (!visible(element) || element.disabled || element.getAttribute("aria-disabled") === "true") return false;
      const text = clean(`${element.innerText || ""} ${element.value || ""} ${element.getAttribute("aria-label") || ""}`, 180);
      return pattern.test(text);
    });
  }
  function bodyText() { return clean(document.body?.innerText || "", 30000); }

  function overlay(options) {
    document.getElementById("ir35careers-assistant")?.remove();
    const root = document.createElement("aside");
    root.id = "ir35careers-assistant";
    const list = (options.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    root.innerHTML = `<div class="ir35-card"><div class="ir35-head"><div class="ir35-brand"><span class="ir35-mark">I</span><span>IR35Careers</span></div><button class="ir35-close" type="button" aria-label="Hide assistant">×</button></div><div class="ir35-body"><h2 class="ir35-title">${escapeHtml(options.title)}</h2><p class="ir35-copy">${escapeHtml(options.message || "")}</p>${list ? `<ul class="ir35-list">${list}</ul>` : ""}<div class="ir35-actions"></div></div></div>`;
    root.querySelector(".ir35-close").addEventListener("click", () => root.remove());
    const actions = root.querySelector(".ir35-actions");
    for (const button of options.buttons || []) {
      const element = document.createElement("button");
      element.type = "button";
      element.className = `ir35-button${button.secondary ? " secondary" : ""}`;
      element.textContent = button.label;
      element.addEventListener("click", async () => {
        element.disabled = true;
        try { await button.onClick(); } finally { element.disabled = false; }
      });
      actions.appendChild(element);
    }
    (document.body || document.documentElement).appendChild(root);
  }
  function escapeHtml(value) {
    return clean(value, 2000).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  }
  async function send(message) {
    return await chrome.runtime.sendMessage(message);
  }
  async function report(result) {
    const response = await send({ type: "RESULT", result });
    if (response?.error) throw new Error(response.error);
    return response;
  }
  async function advance(status) {
    const response = await send({ type: "ADVANCE", status });
    if ((response?.steps || 0) > 24) {
      await pause("unsupported_form", "This employer application has too many changing steps for safe automatic completion.", []);
      return false;
    }
    return true;
  }
  async function pause(actionName, message, fields) {
    for (const field of fields) field.element?.classList.add("ir35careers-field-attention");
    await report({
      status: "needs_user",
      action: actionName,
      message,
      questions: fields.map((field, index) => ({ id: field.id || `field-${index}`, label: field.label, required: true })),
    }).catch(() => null);
    overlay({
      title: actionName === "captcha" ? "Complete the security check" : actionName === "employer_terms" ? "Review the employer declaration" : "Your answer is needed",
      message,
      items: fields.map((field) => field.label).slice(0, 8),
      buttons: [{
        label: "Continue application",
        onClick: async () => {
          const answered = fields.map((field, index) => ({ id: field.id || `field-${index}`, label: field.label, answer: clean(currentValue(field.element), 2000), required: true })).filter((item) => item.answer);
          if (answered.length) await report({ status: "answers", questions: answered });
          fields.forEach((field) => field.element?.classList.remove("ir35careers-field-attention"));
          await run();
        },
      }],
    });
  }
  async function uploadResume(input, resume) {
    const binary = atob(resume.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const file = new File([bytes], resume.filename, { type: resume.mimeType, lastModified: Date.now() });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function fieldSnapshot() {
    return Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea'))
      .filter((element) => visible(element) && !element.disabled)
      .slice(0, 140)
      .map((element, index) => ({ element, id: clean(element.id || element.name || `field-${index}`, 180), label: labelFor(element), required: required(element), type: (element.type || element.tagName).toLowerCase() }));
  }
  async function handleVerification(packet, codeInput) {
    if (!packet.account.automaticEmailVerification) {
      await pause("verification_code", "Enter the verification code sent to your IR35Careers application email, then continue.", [{ element: codeInput, label: labelFor(codeInput), id: codeInput.id || codeInput.name }]);
      return true;
    }
    overlay({ title: "Checking your application email", message: "IR35Careers will enter the employer verification code as soon as it arrives." });
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const response = await send({ type: "VERIFICATION" });
      if (response?.code) {
        setNativeValue(codeInput, response.code);
        const verify = action(/^(verify|confirm|continue|submit|next)$/i);
        if (verify) {
          await advance("Verification code entered");
          verify.click();
          setTimeout(() => void run(), 1200);
          return true;
        }
        await pause("verification_code", "The code was entered, but the employer's verification button needs your confirmation.", [{ element: codeInput, label: labelFor(codeInput), id: codeInput.id || codeInput.name }]);
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    await pause("verification_code", "The employer verification email has not arrived yet. Keep this page open and continue when the code appears in your IR35Careers inbox.", [{ element: codeInput, label: labelFor(codeInput), id: codeInput.id || codeInput.name }]);
    return true;
  }
  async function handleAccount(packet, fields) {
    const passwords = fields.filter((field) => field.element instanceof HTMLInputElement && field.element.type === "password");
    if (!passwords.length) return false;
    if (!packet.account.enabled || !packet.account.password) {
      await pause("employer_login", "This employer requires an account. Enable employer account automation in your IR35Careers profile, then continue.", passwords);
      return true;
    }
    const email = fields.find((field) => /email/i.test(field.label) && field.element instanceof HTMLInputElement);
    if (email && !currentValue(email.element)) setNativeValue(email.element, packet.account.email);
    for (const password of passwords) if (!currentValue(password.element)) setNativeValue(password.element, packet.account.password);
    const accountUnresolved = await fillApplication(
      packet,
      fields.filter((field) => !passwords.includes(field)),
    );
    const legal = fields.filter((field) => field.element instanceof HTMLInputElement && field.element.type === "checkbox" && !field.element.checked && LEGAL.test(field.label));
    if (legal.length) {
      await pause("employer_terms", "Read and accept the employer's declaration on this page. IR35Careers will continue with the same prepared application after you confirm it.", legal);
      return true;
    }
    if (accountUnresolved.length) {
      await pause("employer_login", "Complete the highlighted employer account fields. Your private IR35Careers email and secure password are already filled.", accountUnresolved);
      return true;
    }
    const access = action(/^(create account|create an account|register|sign up|sign in|log in|continue|next)$/i);
    if (!access) {
      await pause("employer_login", "The employer account page needs your attention. Complete the highlighted account fields, then continue.", passwords);
      return true;
    }
    overlay({ title: "Opening your employer application account", message: `Using ${packet.account.email} so employer messages stay linked to this application.` });
    await advance("Employer account details completed");
    access.click();
    setTimeout(() => void run(), 1400);
    return true;
  }
  async function fillApplication(packet, fields) {
    const unresolved = [];
    const handledRadioNames = new Set();
    for (const field of fields) {
      const element = field.element;
      if (element instanceof HTMLInputElement && element.type === "file") {
        if (!element.files?.length) await uploadResume(element, packet.resume);
        continue;
      }
      if (element instanceof HTMLInputElement && element.type === "password") continue;
      const label = field.label;
      if (element instanceof HTMLInputElement && (element.type === "radio" || element.type === "checkbox") && currentValue(element)) continue;
      if (!(element instanceof HTMLInputElement && (element.type === "radio" || element.type === "checkbox")) && clean(currentValue(element))) continue;
      let value = /cover.?letter|supporting statement|why.*(?:role|company)/i.test(label) ? packet.coverLetter : factFor(label, packet);
      if (LEGAL.test(label)) value = "";
      if (element instanceof HTMLSelectElement) {
        if (value) {
          const option = closestOption(value, Array.from(element.options).map((item) => ({ label: item.textContent || item.value, value: item.value })));
          if (option) {
            element.value = option.value;
            element.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      } else if (element instanceof HTMLInputElement && element.type === "radio") {
        if (handledRadioNames.has(element.name)) continue;
        handledRadioNames.add(element.name);
        const group = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(element.name)}"]`));
        const option = closestOption(value, group.map((item) => ({ label: labelFor(item), value: item.value, element: item })));
        if (option?.element) option.element.click();
      } else if (element instanceof HTMLInputElement && element.type === "checkbox") {
        if (/^yes$/i.test(value) && !element.checked) element.click();
      } else if (value) {
        setNativeValue(element, value);
      }
      const radioCompleted =
        element instanceof HTMLInputElement &&
        element.type === "radio" &&
        element.name &&
        Boolean(document.querySelector(`input[type="radio"][name="${CSS.escape(element.name)}"]:checked`));
      if (field.required && !radioCompleted && !clean(currentValue(element))) unresolved.push(field);
    }
    return unresolved;
  }
  async function run() {
    if (!document.body) {
      await new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
    }
    const response = await send({ type: "PACKET" });
    if (!response?.active || !response.packet) return;
    if (response.error) {
      overlay({ title: "Application could not continue", message: response.error });
      return;
    }
    const packet = response.packet;
    const text = bodyText();
    const success = text.match(SUCCESS)?.[0];
    if (success || /(?:thank|success|confirmation|application-submitted)/i.test(location.href)) {
      const confirmation = clean(success || "Application submitted successfully.", 1000);
      const result = await report({ status: "submitted", confirmation, url: location.href }).catch((error) => ({ error: error.message }));
      overlay({ title: result?.error ? "Confirmation needs review" : "Application submitted", message: result?.error || "The employer confirmed the application. IR35Careers has updated your tracker and will email you the receipt." });
      return;
    }
    const captchaElement = Array.from(document.querySelectorAll(CAPTCHA)).find((element) => {
      if (!visible(element)) return false;
      const box = element.getBoundingClientRect();
      return box.width >= 160 && box.height >= 50;
    });
    if (captchaElement) {
      await pause("captcha", "Complete the employer security check on this page. Then select Continue application. Your completed fields and uploaded CV stay here.", []);
      return;
    }
    const fields = fieldSnapshot();
    const codeInput = fields.map((field) => field.element).find((element) => element instanceof HTMLInputElement && (/one-time-code/i.test(element.autocomplete) || /(?:verification|security|one.?time|otp).*code|code/i.test(labelFor(element))));
    if (codeInput && /verification|verify|security code|one.?time|check your email|enter.*code/i.test(text)) {
      await handleVerification(packet, codeInput);
      return;
    }
    if (await handleAccount(packet, fields)) return;
    const hasApplicationSignals = fields.some((field) => /name|email|phone|resume|curriculum|cover.?letter|sponsor|authori[sz]|postcode|address/i.test(`${field.label} ${field.type}`));
    if (!hasApplicationSignals) {
      const apply = action(/^(apply|apply now|apply for this job|start application|continue application|submit application)$/i);
      if (apply) {
        overlay({ title: "Opening the employer application", message: "Your approved IR35Careers packet will continue on the next page." });
        await advance("Opening employer application");
        apply.click();
        setTimeout(() => void run(), 1400);
        return;
      }
      await pause("unsupported_form", "IR35Careers could not identify an application form on this page. Use the highlighted employer controls if visible, then continue.", []);
      return;
    }
    overlay({ title: "Completing your application", message: `Uploading your approved CV and filling saved answers for ${packet.job.title}.` });
    const unresolved = await fillApplication(packet, fields);
    const legal = fields.filter((field) => field.element instanceof HTMLInputElement && field.element.type === "checkbox" && !field.element.checked && LEGAL.test(field.label));
    if (legal.length) {
      await pause("employer_terms", "Review and accept the employer declaration shown on this page. Then continue the same application.", legal);
      return;
    }
    if (unresolved.length) {
      await pause("/profile", "Complete the highlighted employer questions. Your CV and all other saved details have already been filled.", unresolved);
      return;
    }
    const submit = action(/^(submit application|submit|send application|apply|finish application|complete application)$/i);
    const next = action(/^(next|continue|save and continue|review application|review)$/i);
    const nextAction = submit || next;
    if (!nextAction) {
      await pause("unsupported_form", "The form is filled, but the employer's next control could not be identified. Select it on this page, then continue.", []);
      return;
    }
    const submitting = nextAction === submit;
    overlay({ title: submitting ? "Submitting to the employer" : "Continuing to the next step", message: submitting ? "IR35Careers will mark this Applied only after the employer confirms it." : "Your approved answers will continue with you." });
    await advance(submitting ? "Submitting application" : "Continuing application");
    nextAction.click();
    setTimeout(() => void run(), submitting ? 2200 : 1400);
  }

  window.addEventListener("message", (event) => {
    if (event.source === window && event.data?.type === "IR35CAREERS_EXTENSION_PING")
      window.postMessage({ type: "IR35CAREERS_EXTENSION_READY", extensionId: chrome.runtime.id }, location.origin);
  });

  const hash = location.hash.replace(/^#/, "");
  const token = hash.match(TOKEN_PATTERN)?.[1];
  if (token) {
    try { history.replaceState(null, document.title, `${location.pathname}${location.search}`); } catch {}
    void send({ type: "START", token }).then(() => run());
  } else {
    const resumeIfActive = () =>
      void send({ type: "PACKET" }).then((response) => {
        if (response?.active) void run();
      }).catch(() => null);
    resumeIfActive();
    setTimeout(resumeIfActive, 700);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "CURRENT") {
      void send({ type: "CURRENT" }).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
      return true;
    }
    if (message.type !== "RUN") return false;
    void run().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ error: error.message }));
    return true;
  });
})();
