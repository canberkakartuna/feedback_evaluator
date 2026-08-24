---
name: turkish-to-prompt
description: Converts a Turkish-language sentence describing a coding task into a clear, actionable Claude Code prompt in English. Use when the user gives a Turkish sentence (task description, bug report, feature request) and wants it turned into a well-formed prompt for Claude Code — triggers on phrases like "convert this Turkish sentence to a prompt", "Türkçe cümleyi prompt yap", or when the input is Turkish text with no other instruction.
---

# Turkish → Claude Code Prompt

Turn the given Turkish sentence into a precise, ready-to-use Claude Code prompt.

## Input

Use the Turkish text passed as arguments to this skill. If no arguments were given, use the most recent Turkish sentence in the conversation. If neither exists, ask the user for the sentence before continuing.

## Steps

1. **Translate faithfully.** Translate the Turkish sentence into English. Preserve every concrete detail exactly — file names, function/variable names, technology names, numbers, error messages — and do not paraphrase them away. Do not add requirements, scope, or assumptions the original sentence didn't state.
2. **Restructure as a prompt, not a translation.** A literal translation is often a description; a Claude Code prompt is a direct instruction. Rewrite it as an imperative command aimed at an engineering agent:
   - Lead with the concrete action (fix, add, refactor, explain, investigate, etc.).
   - Keep any file paths, component names, or constraints from the original sentence.
   - Keep it tight — one to three sentences. Claude Code prompts are direct asks, not briefs.
   - If the Turkish sentence names a target (a file, feature, error), keep that as the anchor of the prompt.
3. **Flag ambiguity instead of guessing.** If the sentence is vague about scope (e.g., unclear which file, which button, "it" with no clear referent), keep the translation faithful but add a one-line note after the prompt asking the user to confirm the missing detail — don't silently invent it.
4. **Output.** Return only the final English prompt in a fenced code block, followed by the ambiguity note if any. Do not add extra commentary, headers, or restate the Turkish input.

## Example

Input (Turkish):
"Giriş formunda şifre alanı boş bırakıldığında Türkçe bir hata mesajı göster ve formu temizleme."

Output:

\`\`\`
On the login form, show a Turkish-language error message when the password field is left empty — do not clear the form.
\`\`\`
