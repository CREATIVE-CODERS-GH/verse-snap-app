# Verse Snap: Instant Bible

Build the first version of a mobile-first Bible utility app called "Verse Snap".

IMPORTANT PRODUCT DIRECTION

Verse Snap is NOT an AI chatbot, AI assistant, AI dashboard, social network, or Bible social platform.

The core purpose is extremely simple:

A user hears or sees a Bible reference and wants to open that Bible verse as quickly as possible.

The eventual core interactions will be:

1. Say a Bible reference → Verse Snap understands it → opens the verse.

2. Scan a Bible reference with the camera → Verse Snap recognizes it → opens the verse.

3. Search/type a Bible reference → Verse Snap opens the verse.

For this first build, focus on the product foundation, navigation, visual design, Bible search/reference lookup interface, verse display, saved verses, history, and settings.

Do NOT implement the voice or camera functionality yet. We will add those in subsequent prompts.

--------------------------------------------------

DESIGN DIRECTION — VERY IMPORTANT

--------------------------------------------------

The UI must look HUMAN-DESIGNED and professionally designed.

Do NOT use the typical "AI-generated" visual style.

Specifically avoid:

- Excessive gradients

- Neon colors

- Glowing elements

- Glassmorphism

- Floating futuristic cards

- Excessive rounded containers

- Giant decorative icons

- Abstract AI graphics

- Robot/AI imagery

- Purple/blue AI gradients

- Excessive shadows

- Excessive animations

- Overly colorful dashboards

- Generic SaaS dashboard layouts

- Huge hero text

- "AI-powered" visual language

- Unnecessary badges

- Decorative blobs

- Excessive empty space

- Excessive pill-shaped UI elements

- Anything that makes the application look like an AI demo

The design should feel like a real, mature mobile application designed by an experienced product designer.

Think:

- Clean

- Quiet

- Elegant

- Functional

- Trustworthy

- Fast

- Familiar

- Accessible

- Premium without being flashy

The Bible should be the visual focus.

The interface should prioritize typography, spacing, hierarchy, and usability rather than decoration.

Use a restrained color palette.

Prefer a warm, neutral foundation with one tasteful accent color.

Do not use gradients unless absolutely necessary.

Use subtle borders and very light shadows only where they improve hierarchy.

Cards should not be everywhere. Use containers only when they serve a clear functional purpose.

Use rounded corners moderately. Avoid making every element a giant rounded rectangle.

The app should look equally appropriate for a 20-year-old and a 60-year-old Bible reader.

--------------------------------------------------

BRAND

--------------------------------------------------

App name:

Verse Snap

Possible tagline:

"Find your verse. Instantly."

Use "Verse Snap" consistently throughout the application.

Do not add an artificial AI tagline.

Do not describe the application as an AI Bible.

--------------------------------------------------

MOBILE-FIRST EXPERIENCE

--------------------------------------------------

Design primarily for mobile screens.

The main experience should work comfortably at approximately:

320px–430px wide.

Touch targets should be comfortable.

Typography should be highly readable.

The application should feel like a real mobile app rather than a desktop website squeezed into a phone.

Use a bottom navigation bar where appropriate.

The main navigation should be:

Home

Saved

History

Settings

Keep navigation simple.

--------------------------------------------------

SCREEN 1 — HOME

--------------------------------------------------

Create a clean home screen.

Top area:

Verse Snap

"Find your verse. Instantly."

Below it, create the primary actions.

PRIMARY ACTION:

"Say a Verse"

Use a microphone icon.

This should visually communicate that voice lookup will eventually be the fastest way to find a verse.

SECONDARY ACTION:

"Snap a Verse"

Use a camera icon.

This will eventually open the camera/OCR functionality.

THIRD ACTION:

"Search the Bible"

This opens manual Bible search.

Do not make all three buttons visually equal.

"Say a Verse" should be the primary action.

"Snap a Verse" should be secondary.

"Search the Bible" can be a simple text/button action.

For now, because voice and camera are not implemented yet, clicking them can show a simple, professional placeholder state explaining:

"Voice search is coming soon."

or

"Camera scanning is coming soon."

Do not create fake functionality.

Below the main actions, add:

"Recent"

Display a small list of recently opened verses.

Example:

Hebrews 2:5

John 3:16

Romans 8:28

Psalm 23:1

These can initially be sample/demo records until the backend is connected.

Add:

"See all"

which navigates to History.

--------------------------------------------------

SCREEN 2 — SEARCH

--------------------------------------------------

Create a dedicated Bible search screen.

Title:

"Search the Bible"

Provide a clean search field.

Placeholder:

"Enter a reference, e.g. John 3:16"

The search should eventually support references such as:

John 3:16

Romans 8:28

Hebrews 2:5

Psalm 23:1

1 Corinthians 13:4

For this first version, implement the interface and basic reference parsing.

The user should be able to type:

"John 3:16"

and get:

John 3:16

as a selectable result.

Also support basic variations where practical:

John 3 16

John chapter 3 verse 16

Do not attempt semantic AI Bible search yet.

Do not build "ask the Bible" or chatbot functionality.

--------------------------------------------------

SCREEN 3 — VERSE VIEW

--------------------------------------------------

Create the main Bible verse reading screen.

Example:

Hebrews 2:5

Then display the verse text in a highly readable typography.

Use generous line height and comfortable margins.

The Bible reference should be visually prominent but not oversized.

Below the verse, provide simple actions:

Listen

Save

Copy

Share

Use recognizable icons with text labels.

Do not put these actions inside excessive decorative cards.

Add previous/next navigation at the bottom:

Previous

Next

Also include a translation selector.

For the initial UI, show:

KJV

We will connect the actual Bible API in a later step.

The translation selector must be designed so additional translations can be added later.

--------------------------------------------------

SCREEN 4 — SAVED

--------------------------------------------------

Create a "Saved" screen.

Display verses the user has saved.

Example:

Saved Verses

John 3:16

Romans 8:28

Psalm 23:1

Philippians 4:13

Each item should show:

Reference

Short preview of verse text

Allow the user to tap a saved verse and return to the Verse View screen.

If there are no saved verses, show a simple empty state:

"No saved verses yet."

"Save verses you want to come back to."

Keep the empty state minimal.

Do not use illustrations or AI-style graphics.

--------------------------------------------------

SCREEN 5 — HISTORY

--------------------------------------------------

Create a History screen.

Title:

"History"

Group recently viewed verses by date.

Example:

Today

Hebrews 2:5

John 3:16

Yesterday

Psalm 23:1

Romans 8:28

Allow users to tap an item to reopen it.

Include a subtle "Clear History" action.

Do not make this screen visually complicated.

--------------------------------------------------

SCREEN 6 — SETTINGS

--------------------------------------------------

Create a clean Settings screen.

Sections:

Bible

Translation

Text Size

Appearance

Theme

Audio

Playback Speed

About

About Verse Snap

Privacy Policy

Terms of Service

For now, the controls can be UI placeholders where backend functionality has not yet been implemented.

Use standard mobile settings patterns.

Avoid dashboard-style cards.

--------------------------------------------------

DATA ARCHITECTURE

--------------------------------------------------

Prepare the application for Supabase.

Create a clean data model conceptually supporting:

users

verses

saved_verses

history

translations

A saved verse should be associated with a user.

History should be associated with a user.

Do not hard-code the application architecture around demo data.

Use a clean service/data layer so the Bible provider can be changed later.

IMPORTANT:

Do not tightly couple the UI directly to the Bible API.

Create a Bible service abstraction.

Conceptually:

UI

↓

Bible Service

↓

Bible API

This will allow us to change Bible providers later without rebuilding the UI.

--------------------------------------------------

BIBLE API

--------------------------------------------------

For now, structure the application so it can connect to:

Free Use Bible API by AO Lab:

https://bible.helloao.org/

Do not invent API endpoints.

If an endpoint needs verification, leave a clearly documented service placeholder rather than creating fake API calls.

The first implementation can use mock/sample Bible data for the UI while keeping the service architecture ready for the real API.

--------------------------------------------------

TECHNICAL DIRECTION

--------------------------------------------------

Use:

React

TypeScript

Tailwind CSS

Supabase-ready architecture

Use reusable components.

Keep the code organized and maintainable.

Do not over-engineer.

Do not create unnecessary dependencies.

Do not introduce an AI framework.

Do not introduce chatbot functionality.

Do not create unnecessary backend services.

--------------------------------------------------

RESPONSIVE DESIGN

--------------------------------------------------

Although this is mobile-first, ensure the interface also behaves properly on tablets and desktop browsers.

On desktop, keep the application content at a comfortable reading width rather than stretching everything across the screen.

The verse reading experience should remain focused and readable.

--------------------------------------------------

IMPORTANT PRODUCT PRINCIPLE

--------------------------------------------------

Every screen should answer one question:

"Does this help the user find and read a Bible verse faster?"

If a design element does not contribute to that purpose, leave it out.

The application should feel calm and trustworthy.

It should feel like a product that could genuinely be published in the App Store and Google Play Store.

Do not make it look like a generated prototype.

Build the UI with the restraint and consistency of a professionally designed consumer mobile application.

--------------------------------------------------

DELIVERABLE

--------------------------------------------------

Build the complete initial frontend foundation with:

1. Home

2. Search

3. Verse View

4. Saved

5. History

6. Settings

7. Bottom navigation

8. Responsive mobile-first styling

9. Clean component structure

10. Supabase-ready data architecture

11. Bible service abstraction

12. Sample Bible data for testing

Do not implement voice recognition or camera scanning yet.

Do not add additional features that were not requested.

After completing the build, briefly explain what was implemented and identify any parts that are placeholders for the next development phase. you can ask me questions
