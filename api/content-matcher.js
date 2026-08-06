const CONTENT_PATTERNS = {
  applicationLetter: {
    name: "Application Letter",
    filenameKeywords: ["application letter", "letter of application", "app letter", "intent letter", "joint application", "start up application", "start-up application", "joint start-up aplication", "start-up aplication"],
    contentPhrases: [
      "application letter", "letter of application", "we are applying", "i am applying",
      "formally applying", "application for", "letter of intent", "intent to apply",
      "submit this application", "apply for", "young farmers challenge",
      "dear sir", "dear madam", "to whom it may concern"
    ],
    contextWords: ["applicant", "application", "apply", "program", "challenge", "submit"],
    weight: { filename: 0.35, contentExact: 0.40, contentContext: 0.25 },
    excludeFilenameKeywords: ["application form", "app form", "form b"]
  },
  applicationForm: {
    name: "Application Form",
    filenameKeywords: ["application form", "app form", "form b", "start up form", "entry form", "registration form", "application-form", "application form start"],
    contentPhrases: [
      "application form", "form b", "registration form", "entry form",
      "fill out", "complete the form", "applicant information",
      "name of applicant", "date of birth", "address", "contact number",
      "signature of applicant", "date signed"
    ],
    contextWords: ["form", "fill", "applicant", "information", "signature", "date"],
    weight: { filename: 0.35, contentExact: 0.40, contentContext: 0.25 }
  },
  businessModelCanvas: {
    name: "Business Model Canvas (BMC)",
    filenameKeywords: ["business model canvas", "business model", "bmc template", "canvas", "bmc", "youth agri-business model", "agri business model", "agribusiness model", "business plan"],
    contentPhrases: [
      "business model canvas", "value proposition", "customer segment",
      "revenue stream", "cost structure", "key partnership", "key activity",
      "key resource", "channel", "customer relationship", "bmc",
      "business plan", "agri-business", "agribusiness"
    ],
    contextWords: ["business", "model", "canvas", "revenue", "customer", "value"],
    weight: { filename: 0.35, contentExact: 0.40, contentContext: 0.25 }
  },
  bmcFinancials: {
    name: "BMC Financials",
    filenameKeywords: ["bmc financial", "financial projections", "projections", "financial plan", "bmc financials", "projected financial"],
    contentPhrases: [
      "financial projection", "projected revenue", "projected expense",
      "financial plan", "bmc financial", "startup cost", "capital requirement",
      "break even", "profit loss", "cash flow projection"
    ],
    contextWords: ["financial", "projection", "plan", "revenue", "cost", "profit"],
    weight: { filename: 0.35, contentExact: 0.40, contentContext: 0.25 }
  },
  financialFigures: {
    name: "Financial Figures / Expenses",
    filenameKeywords: ["activity and financial plan", "financial plan", "cashflow", "cash flow", "financial statement", "budget", "income statement", "balance sheet", "expenses", "financial figures", "financial projection", "projected expenses", "projected income"],
    contentPhrases: [
      "financial figure", "expense", "operating expense", "cost breakdown",
      "budget", "income", "revenue", "cash flow", "balance sheet",
      "profit loss", "financial statement", "cost of goods", "sales",
      "projected expense", "monthly expense", "annual expense",
      "capital expenditure", "operating cost", "overhead"
    ],
    contextWords: ["financial", "expense", "budget", "income", "revenue", "cost", "profit"],
    weight: { filename: 0.35, contentExact: 0.40, contentContext: 0.25 }
  },
  validId: {
    name: "Valid ID",
    filenameKeywords: ["valid id", "government id", "national id", "philid", "driver license", "drivers license", "umid", "voter id", "postal id", "prc id", "passport id", "passport", "id card", "scanned copy valid id", "identification", "philsys"],
    contentPhrases: [
      "valid id", "government id", "national id", "driver license",
      "passport", "umid", "voter id", "postal id", "prc id",
      "identification card", "identity card", "philhealth", "sss",
      "date of birth", "id number", "civil status", "citizenship",
      "republic of the philippines", "philippine identification"
    ],
    contextWords: ["id", "license", "passport", "identification", "birth", "number"],
    weight: { filename: 0.30, contentExact: 0.45, contentContext: 0.25 }
  },
  swornStatement: {
    name: "Sworn Statement of New Business",
    filenameKeywords: ["sworn statement", "affidavit", "joint affidavit", "form c", "form j", "declaration new business", "authority to use land", "sworn statement of new business"],
    contentPhrases: [
      "sworn statement", "affidavit", "do hereby swear", "under oath",
      "joint affidavit", "declare", "declaration", "truthful",
      "penalty of perjury", "subscribed and sworn", "notary public"
    ],
    contextWords: ["affidavit", "sworn", "declare", "oath", "notary"],
    weight: { filename: 0.35, contentExact: 0.40, contentContext: 0.25 }
  },
  proofOfResidency: {
    name: "Proof of Residency",
    filenameKeywords: ["proof of residency", "residency", "residence", "barangay certificate", "barangay clearance", "certificate of residency", "proof of address", "proof of residence"],
    contentPhrases: [
      "proof of residency", "certificate of residency", "barangay certificate",
      "barangay clearance", "proof of address", "residing at",
      "certified resident", "resident of", "address",
      "barangay", "residency certificate", "residence certificate",
      "to whom it may concern", "this is to certify"
    ],
    contextWords: ["residency", "resident", "barangay", "certificate", "address", "certify"],
    weight: { filename: 0.30, contentExact: 0.40, contentContext: 0.30 }
  },
  endorsementLetter: {
    name: "Endorsement Letter",
    filenameKeywords: ["endorsement letter", "endorsement", "endorsment", "recommending letter", "recommendation", "reccomendation", "lgu endorsement", "endorse", "agriculture office", "municipal agriculture"],
    contentPhrases: [
      "endorsement", "endorse", "endorsement letter", "letter of endorsement",
      "recommend", "recommendation", "recommending",
      "we endorse", "this is to endorse", "support the application",
      "municipal agriculture", "agriculture office"
    ],
    contextWords: ["endorse", "endorsement", "recommend", "support", "office"],
    weight: { filename: 0.35, contentExact: 0.40, contentContext: 0.25 }
  },
  photo2x2: {
    name: "2 x 2 Photo",
    filenameKeywords: ["2x2", "2 x 2", "2by2", "id photo", "applicant photo", "headshot", "passport photo", "picture", "photo", "2x2 picture", "passport picture"],
    contentPhrases: [],
    contextWords: ["photo", "picture", "headshot"],
    weight: { filename: 0.50, contentExact: 0.0, contentContext: 0.50 },
    imageOnly: true
  },
  signatures: {
    name: "Required Signatures",
    filenameKeywords: ["signed", "signature", "signed form", "signed copy", "with signature", "signatories", "signed application"],
    contentPhrases: [
      "signature", "signed", "signatory", "subscribed",
      "name", "date signed", "applicant signature"
    ],
    contextWords: ["signature", "signed", "name"],
    weight: { filename: 0.30, contentExact: 0.35, contentContext: 0.35 }
  },
  declarationOfIntent: {
    name: "Declaration of Intent",
    filenameKeywords: ["declaration of intent", "declaration intent", "intent declaration", "group declaration", "annex a", "joint declaration", "declaration"],
    contentPhrases: [
      "declaration of intent", "intent to", "we intend",
      "declare our intent", "joint declaration", "group declaration",
      "purpose", "objective", "aim to", "propose"
    ],
    contextWords: ["declaration", "intent", "declare", "purpose", "objective"],
    weight: { filename: 0.35, contentExact: 0.40, contentContext: 0.25 }
  }
};

const GROUP_EVIDENCE_PHRASES = [
  "joint", "joint affidavit", "joint application", "joint startup", "joint start-up",
  "partnership", "partners", "co-owner", "co-owners", "group members",
  "multiple applicant", "member list", "member information",
  "we, the undersigned", "all members", "group declaration",
  "association", "cooperative", "organization"
];

const INDIVIDUAL_EVIDENCE_PHRASES = [
  "individual application", "sole proprietor", "solo",
  "i, the undersigned", "my application", "personal application"
];

function normalizeText(text) {
  if (!text) return "";
  let n = text.toLowerCase();
  n = n.replace(/[\r\n]+/g, ' ');
  n = n.replace(/\s+/g, ' ');
  n = n.replace(/[^\w\s.,;:!?\-\/]/g, ' ');
  n = n.replace(/\s+/g, ' ').trim();
  return n;
}

function calculateContentScore(requirement, filename, normalizedFilename, normalizedContent) {
  const pattern = CONTENT_PATTERNS[requirement];
  if (!pattern) return { score: 0, evidence: [], method: "NO_PATTERN" };

  let score = 0;
  const evidence = [];
  let matchMethod = "NONE";

  const excludeKeywords = pattern.excludeFilenameKeywords || [];
  const isExcluded = excludeKeywords.some(ekw => normalizedFilename.includes(ekw.toLowerCase()));
  if (isExcluded) {
    return { score: 0, evidence: [], method: "EXCLUDED" };
  }

  for (const kw of pattern.filenameKeywords) {
    if (normalizedFilename.includes(kw.toLowerCase())) {
      score += pattern.weight.filename;
      evidence.push(`Filename contains "${kw}"`);
      matchMethod = "FILENAME_EXACT";
      break;
    }
  }

  if (matchMethod === "NONE") {
    const fnWords = normalizedFilename.split(/\s+/);
    const kwWords = pattern.filenameKeywords.flatMap(kw => kw.toLowerCase().split(/\s+/));
    const overlap = fnWords.filter(w => kwWords.includes(w) && w.length > 2);
    if (overlap.length >= 2) {
      score += pattern.weight.filename * 0.7;
      evidence.push(`Filename word overlap: ${overlap.join(", ")}`);
      matchMethod = "FILENAME_PARTIAL";
    }
  }

  if (normalizedContent) {
    for (const phrase of pattern.contentPhrases) {
      if (normalizedContent.includes(phrase.toLowerCase())) {
        score += pattern.weight.contentExact;
        evidence.push(`Content contains "${phrase}"`);
        matchMethod = matchMethod === "NONE" ? "OCR_EXACT" : matchMethod + "+OCR_EXACT";
        break;
      }
    }
  }

  if (normalizedContent && score < 0.8) {
    let contextHits = 0;
    const matchedContextWords = [];
    for (const word of pattern.contextWords) {
      if (normalizedContent.includes(word.toLowerCase())) {
        contextHits++;
        matchedContextWords.push(word);
      }
    }
    if (contextHits >= 4) {
      const contextScore = pattern.weight.contentContext * Math.min(contextHits / pattern.contextWords.length, 1);
      score += contextScore;
      evidence.push(`Content context words: ${matchedContextWords.join(", ")}`);
      matchMethod = matchMethod === "NONE" ? "OCR_CONTEXT" : matchMethod + "+OCR_CONTEXT";
    }
  }

  return {
    score: Math.min(score, 1.0),
    evidence,
    method: matchMethod
  };
}

function classifyGroupFromContent(allFileTexts) {
  const combinedText = allFileTexts.join(" ").toLowerCase();
  let groupScore = 0;
  let individualScore = 0;
  const evidence = [];

  for (const phrase of GROUP_EVIDENCE_PHRASES) {
    if (combinedText.includes(phrase.toLowerCase())) {
      groupScore += 1;
      evidence.push(`content:${phrase}`);
    }
  }

  for (const phrase of INDIVIDUAL_EVIDENCE_PHRASES) {
    if (combinedText.includes(phrase.toLowerCase())) {
      individualScore += 1;
      evidence.push(`content:${phrase}`);
    }
  }

  return { groupScore, individualScore, evidence };
}

function matchRequirementWithContent(requirementKey, filename, fileContent, applicantType) {
  const pattern = CONTENT_PATTERNS[requirementKey];
  if (!pattern) return null;

  const normalizedFilename = normalizeText(filename);
  const normalizedContent = fileContent ? normalizeText(fileContent.text || "") : "";

  const { score, evidence, method } = calculateContentScore(
    requirementKey, filename, normalizedFilename, normalizedContent
  );

  let status;
  let statusDetail;

  if (score >= 0.90) {
    status = "COMPLETE";
    statusDetail = `Confirmed match: "${filename}"`;
  } else if (score > 0) {
    status = "CHECK";
    statusDetail = `We found a possible document for this requirement: "${filename}"`;
  } else {
    status = "MISSING";
    statusDetail = "No matching document found.";
  }

  if (requirementKey === "declarationOfIntent" && applicantType === "INDIVIDUAL" && score < 0.3) {
    status = "NOT_APPLICABLE";
    statusDetail = "Not required for INDIVIDUAL applicants";
  }

  return {
    status,
    statusDetail,
    confidence: Math.round(score * 100) / 100,
    evidence,
    method,
    filename,
    contentSnippet: normalizedContent ? normalizedContent.substring(0, 200) : ""
  };
}

module.exports = {
  CONTENT_PATTERNS,
  GROUP_EVIDENCE_PHRASES,
  INDIVIDUAL_EVIDENCE_PHRASES,
  calculateContentScore,
  classifyGroupFromContent,
  matchRequirementWithContent,
  normalizeText
};
