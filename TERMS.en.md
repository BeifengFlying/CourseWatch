# CourseWatch Project Terms

[简体中文](TERMS.md) · **English**

Applicable project: CourseWatch. The combination of the Apache-2.0 text and these Additional Terms applies to newly released material supplied with these documents starting with 0.2.33 (build 33). The noncommercial requirement began with build 32. Previously released build 32 copies and other historical versions remain subject to the terms supplied with them. Updated: 2026-11-15.

**Noncommercial use only. Commercial use is prohibited.** See Section 8 for commercial purposes, redistribution and prior grants.

The Project uses the [Apache License 2.0 text](LICENSE) together with these Additional Terms. LICENSE, TERMS.md / TERMS.en.md and NOTICE must be read and supplied together. For covered material that the relevant rights holders have authority to license under this combination, explicit custom provisions in these Terms take precedence over the Apache text where they actually conflict. Apache provisions that do not conflict continue to apply. This priority does not override independent third-party licenses, prior grants or mandatory law.

The Apache text is preserved verbatim. Noncommercial restrictions and other custom requirements are set out in these Terms. The resulting authorization is a **restricted combination of the Apache-2.0 text and custom terms**, not an unmodified standard Apache-2.0 grant or an OSI-defined open-source license. It must not be labeled solely as Apache-2.0 or described as allowing unrestricted commercial use. LICENSE alone does not offer a separate unrestricted commercial grant for new material covered by this combination. Formation and enforceability remain subject to applicable law and actual ownership.

Definitions: “Project” means the original CourseWatch code, documentation and applications provided by the maintainer. “User” means an individual or organization that downloads, installs, runs, modifies or redistributes the Project. “Learning Platform” means a third-party educational website to which the Project connects or provides a link. “Platform Data” means courses, homework, exams, dates, times, statuses and related content read from a Learning Platform, excluding personal schedules created by the User.

## 0. License Documents, Custom Provisions and Priority

0.1 These Terms cover new original code, documentation and other material that the relevant rights holders have authority to license under this combination. Third-party software, assets, platform content and external contributions without the necessary authorization do not change licenses merely by being in this repository. A version change, repackaging or repository change cannot withdraw prior rights in the same material already covered by an earlier grant.

0.2 **Within Section 0.1, an explicit custom provision in these Terms takes precedence where it conflicts with the Apache-2.0 text on the same licensing matter.** Apache provisions not changed by these Terms continue to apply. Mandatory statutory rights, independent third-party licenses and valid prior grants are outside this priority rule. The rule does not guarantee judicial enforcement of any provision.

0.3 Custom requirements and their relationship to the Apache text are as follows:

| Matter addressed by Apache | Additional or limited requirement in these Terms | Applicable sections |
| --- | --- | --- |
| Section 2: reproduction, modification, sublicensing, and distribution in source or object form | Covered material may be used, copied, modified and distributed only for noncommercial purposes; the Apache text does not authorize a prohibited commercial sublicense for that material | Sections 8.1 and 8.4–8.6 |
| Section 4: retaining licenses, copyright and modification notices on redistribution | Applicable Apache notice requirements remain; these Terms, NOTICE, the disclaimer, privacy and third-party notices must also be supplied, with a prominent noncommercial statement | Sections 8.2 and 8.7 |
| Section 4: different terms for modifications or derivative works as a whole | Changing licenses, splitting modules, renaming or changing distribution form must not remove commercial restrictions from covered material; independent third-party and previously licensed material retain their own terms | Sections 0.1, 8.3 and 8.7 |
| Sections 7 and 8: warranty disclaimer and limitation of liability | Retain those provisions where lawful, describe beta risks, and preserve liability and rights that cannot lawfully be excluded | Section 5 and DISCLAIMER.md |
| Platform access, platform data and identifiers | No grant of third-party account, exam, course, identifier or platform-access rights; use remains subject to law and necessary authorization | Sections 1–4, 6 and 7 |

0.4 [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt) retains a copy of the standard Apache text. [licenses/CourseWatch-Noncommercial-1.0.txt](licenses/CourseWatch-Noncommercial-1.0.txt) retains the separate noncommercial license supplied with the initial build 32 release. These documents record relevant versions, prior grants and third-party matters, and do not offer optional alternative grants for new material. Previously delivered build 32 source and packages are not retroactively placed under different terms by this change in document structure.

0.5 The Chinese and English texts are intended to have the same meaning. An ambiguity or translation difference does not imply withdrawal of third-party or prior rights, or a grant of additional commercial permission. Seek written clarification from the relevant rights holders through the Project's public feedback channel. These documents do not replace a complete ownership or legal review.

## 1. Data Sources

1.1 The Project reads Learning Platform pages and list responses normally loaded by those pages, using list URLs configured by the User and a login session belonging to the User or used with authorization. It parses, aggregates and caches the data and records changes. Platform access may require login, CAPTCHA or other manual verification. The Project does not guarantee access to all courses, pages of results or tasks.

1.2 Platform Data is provided and updated by the respective platform. Page changes, expired sessions, network conditions, parsing rules and cached data may cause omissions, delays, duplicates or errors in the content displayed by the Project. Official notices from the Learning Platform, instructors and institution govern homework requirements, submission results, exam arrangements and deadlines.

1.3 Personal schedules, notes, importance flags and personal completion statuses are created or modified locally by the User. Marking a task complete in CourseWatch does not constitute submission to a Learning Platform or replace official confirmation of submission.

1.4 The Project displays items in its main window, system notifications and menu bar task preview. System notifications may include task names, courses, and start and end times. The menu bar preview displays up to six incomplete items and their times; it does not constitute a complete task list or an official notice.

## 2. Copyrighted Data and Personal Information

2.1 Reading, caching or displaying Platform Data does not grant the Project copyright or other rights in that data. Users must process such data within the scope of their own studies or other authorization. They must not publicly distribute exam questions, course materials, other individuals' personal information or other protected content without permission.

2.2 Users must protect account passwords, cookies, session snapshots, separate browser profile directories and exported files. Information submitted with issue reports must be redacted first. Login sessions, keys and complete databases must not be uploaded publicly. See the [Privacy and Data Notice](PRIVACY.md) for storage, network access and data removal details.

2.3 Data that is no longer needed should be removed according to its purpose and applicable rules. Removing local data does not revoke platform login sessions or make unauthorized collection or distribution lawful. The Project provides no rule under which storing or using data for no more than 24 hours grants authorization.

2.4 System notifications may display item information on a locked screen or during screen sharing. Menu bar previews and icon hover text may also be visible to people nearby or participating in screen sharing. Closing the main window does not automatically clear existing notifications or stop menu bar display. Users may adjust macOS notification and preview settings and close a pinned menu bar panel as needed. To stop the application from running in the background, select “Quit CourseWatch.”

## 3. Learning Platform Names and Marks

3.1 Platform names, abbreviations and icons in the Project are used solely to identify the corresponding websites. They do not indicate that the Project is operated by an institution or platform, is authorized to act as its agent, or is recommended or endorsed by it.

3.2 Rights holders who object to the use of a platform name or mark may contact the maintainer through the Project's public feedback channel or the channel through which the test package was supplied. They should identify the relevant rights and specific content. The maintainer will review the matter and handle it under applicable rules.

## 4. Use of Third-Party Resources

4.1 Third-party software and assets used by the Project remain subject to their original terms. Sources and licensing information are listed in the [Third-Party Notices](THIRD_PARTY_NOTICES.md) and license files included with the distribution. The Project's license and these Terms do not cover third-party content that the Project has no authority to license.

4.2 Public availability, attribution or a removal request channel does not establish authorization to redistribute content. Anyone distributing the Project or a modified version must verify the basis for using included software, assets and Platform Data, and retain applicable copyright, license and attribution notices.

## 5. Beta Status and Disclaimer

5.1 The current version is intended to test task collection, personal schedules and notifications. It may have incomplete task collection, incorrect dates, times or statuses, delayed or missing notifications, expired sessions, data loss and compatibility issues. Continued availability, complete collection, successful reminder delivery and long-term maintenance are not guaranteed.

5.2 Users must independently verify homework, exams and deadlines, retain other reminder methods, and back up important items before upgrading or removing data. CourseWatch must not be used as the sole source of reminders. Completion marks within the application must not be treated as proof of submission to a platform.

5.3 To the extent permitted by applicable law and unless otherwise agreed in writing, the Project is provided on an “as is” basis. Liability for missed homework, missed exams, effects on grades or academic progress, account restrictions, data loss or other losses arising from use of, or inability to use, the Project is governed by these Terms, [Sections 7 and 8 of Apache-2.0](LICENSE), and applicable law. Specific risks and the scope of liability are described in the [Beta Use Notice and Disclaimer](DISCLAIMER.md).

5.4 These Terms do not exclude or limit liability that cannot lawfully be excluded or limited, including liability for personal injury where exclusion is prohibited, liability for property loss caused by intentional misconduct or gross negligence where exclusion is prohibited, or other statutory rights.

5.5 After the main window is closed or minimized, the application may continue running in the menu bar and perform monitoring and reminders according to its configuration. Suspending main-window rendering does not stop the background service. “Pause monitoring” in the menu bar does not quit the application or disable all reminders. Immediate reminders are unavailable while the computer is asleep or powered off, or after the application exits. Acceptance of a notification by the system does not mean the User has seen it.

## 6. Restrictions on Use

6.1 The Project must not be used in violation of applicable laws or regulations. Users must comply with institutional rules and Learning Platform terms of service. Ownership of an account does not necessarily mean that the platform permits automated access. Connections must be stopped where such access is not permitted.

6.2 The Project must not be used to access another person's account or data without authorization, bypass access controls or CAPTCHA, attack a platform, collect data beyond the permitted scope, or assist cheating. Chaoxing automated study is an experimental feature that is off by default and requires separate confirmation. It is intended solely for technical testing permitted by law, institutional rules and the platform. Chapter practice may be filled and submitted automatically only after automatic submission is enabled separately. Course homework only generates answers; exams are not processed. Feature risks, User responsibilities and liability that cannot lawfully be excluded are described in the [Chaoxing experimental study section of the Disclaimer](DISCLAIMER.md#学习通自动学习试验功能).

6.3 Automated access may trigger platform verification, rate limits or account risk controls. The Project does not guarantee continued availability of the current access methods. Liability arising from unlawful or prohibited conduct is borne by the responsible parties under applicable law. These Terms do not exempt the developer from liability imposed by law.

## 7. Academic Matters and Platform Rights

7.1 Users should complete homework and exams through the Learning Platform and independently confirm successful submission. Where CourseWatch differs from an official notice, the official notice governs. Redacted reproduction details may be reported to the maintainer.

7.2 Users must respect rights in course content, exam questions and platform software. The Project's license must not be treated as authorization to copy, sell or publicly distribute third-party content.

## 8. Prohibition of Commercial Use and Redistribution

8.1 **Starting with build 32 (0.2.32), commercial use of new original material that the Project has authority to license, including modifications of that material, is prohibited.** Starting with build 33, this combination permits noncommercial use, reproduction, study, modification and redistribution of covered material, subject to these Terms and applicable Apache provisions. Build 32 and other historical versions remain subject to the terms supplied with them. The Project is free, accepts no advertising partnerships or donations, and makes no commitment to paid support, reminder effectiveness or academic outcomes.

8.2 Noncommercial redistribution of source, installers, portable packages, modified versions or other copies containing covered material must retain LICENSE, NOTICE and applicable copyright and attribution notices. Supply the Chinese or English version of these Terms, DISCLAIMER.md, PRIVACY.md and applicable third-party notices and licenses. Distribution pages and accompanying documentation must prominently state “Noncommercial use only. Commercial use is prohibited.” Do not remove or obscure this restriction. Prominently identify changes to others' files, do not present modified versions as original releases, and do not imply endorsement by the maintainer, an institution or a platform.

8.3 These restrictions apply only where the relevant rights holders have authority to impose them and applicable law permits. They do not alter independent third-party licenses or retroactively withdraw valid Apache-2.0, separate noncommercial or other prior grants. Recipients who lawfully obtained historical versions or previously licensed material may continue under the relevant original terms. Obtaining newly restricted material does not automatically expand an earlier grant.

8.4 The following commercial purposes are prohibited unless separately authorized in writing under Section 8.6:

- Selling the software, source or modified versions; charging for downloads, activation codes or membership access; or requiring payment or tips to obtain the software, features or services.
- Providing paid deployment, hosting, proxy operation, proxy-study or other business services relying on covered material.
- Integrating, bundling or embedding covered material in paid products, services, commercial packages or business systems. A free copy tied to revenue from associated products or services remains restricted.
- Using covered material for advertising, commercial promotion, sales commissions or other direct or indirect commercial revenue.
- Using covered material to develop or operate commercial products or carry out other business activities intended for commercial advantage.

8.5 Direct payment is not the sole criterion; consider the actual purpose and related transactions. Personal noncommercial study, research and testing do not automatically become commercial because the user is employed by an organization. Educational, charitable, research, government and other institutions do not receive an automatic exemption from commercial restrictions because of their identity. Statutory exceptions and rights that cannot lawfully be restricted remain in effect.

8.6 Commercial use requires a separate written grant from the relevant rights holders before it begins, and must stay within that grant. Public source, free downloads, attribution, a proposed partnership, lack of a response or GitHub availability do not imply commercial permission. No one may grant rights on behalf of a third party they lack authority to represent.

8.7 Do not label covered material solely as Apache-2.0 or evade restrictions by changing licenses, closed-source wrapping, open-source publication, renaming, splitting or repackaging. These Terms do not generally require publication of modified source; publishing source does not itself authorize commercial use. Independent third-party source-provision and other obligations still apply. Redistribution and sublicensing must not grant commercial rights that these Terms do not authorize.

8.8 The standard Apache-2.0 text itself permits commercial use. The noncommercial restrictions above come from these Additional Terms and apply together with the Apache text under Section 0; they are not standard Apache-2.0 provisions. Removing packages, deleting tags, rebuilding history or changing license files does not withdraw valid earlier grants or guarantee removal of old copies or GitHub-retained objects.

8.9 Commercial conduct outside this combination's scope is not licensed by it. Termination for violations, cessation of infringement and other remedies remain subject to applicable law. This provision does not exclude statutory defenses, replace a valid separate commercial grant, or withdraw continuing third-party or prior rights.

## 9. Acceptance of These Terms

9.1 Before downloading, installing or using the Project, read these Terms, the [Beta Disclaimer](DISCLAIMER.md) and the [Privacy and Data Notice](PRIVACY.md). Use of the Project indicates acceptance of those documents. Users who do not accept them should stop using the Project and remove local data as appropriate. Formation and enforceability of that agreement, and any duty to provide notice or explanation, remain subject to applicable law. Acceptance does not mean that Users waive all statutory rights.

9.2 Redistributors must provide recipients with the above documents and applicable licenses, retain beta labels and known limitations, and avoid presenting a test package as a fully verified stable release.

9.3 Any changes to the Terms in later versions must state the applicable version and update date. New terms do not retroactively replace previously applicable licenses or unilaterally revoke rights already lawfully granted on an irrevocable basis.

Questions about these Terms or beta versions may be directed to the maintainer through the Project's public feedback channel or the original channel through which the test package was supplied. Do not include account credentials or unredacted personal data in public feedback.
