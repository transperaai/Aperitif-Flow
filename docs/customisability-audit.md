# Customisability audit: what is hardcoded

50 findings confirmed by a second agent (1 refuted). Most important first.

## 1. Churn-driver pressure curves are fixed: overload at 85% busy, early tenure = 26 weeks, response/rework 'full pressure' shares, handoff away bump, results 'normal' score, price-rise memory  
*high · engine*

Status: fixed in this branch

- **Now:** Only each driver's weight, on/off and one 'value' (e.g. onboarding normal days, handoff share, results score, tenure multiplier, price rise %) are stored. The thresholds that turn a measurement into churn pressure are constants: a team counts as overloaded only above 85% busy and is full pressure at 100%; 'early tenure' is always the first 26 weeks; 50% late ad-hoc requests or 25% reworked visits is maximum pressure; an away account team always adds +0.5; a rating of 8/10 is 'normal'; a price rise weighs for 13 weeks at 2x.
- **Why it matters:** An owner whose clients only start leaving when the team is 95% busy, or whose risky period is the first 3 months not 6, cannot tell the simulator; the churn blamed on each driver and the lost revenue are driven by our guesses, not their business.
- **Fix:** Settings > Churn drivers: add a 'starts at' / 'full at' field per measured driver (load threshold, response and rework full shares), an 'early tenure months' field on the tenure driver, an 'away adds' field on handoff, and a 'normal rating' on results. Store as extra columns on churn_drivers, pass through packages/db/src/model.ts churnDrivers into EngineChurnDriver, and read them in simulate.ts driveClient instead of the constants (constants become defaults).
- **Where:** `packages/engine/src/churn-drivers.ts:287-303 (REWORK_FULL_SHARE 0.25, RESPONSE_FULL_SHARE 0.5, LOAD_THRESHOLD 0.85, LOAD_FULL 1, EARLY_TENURE_WEEKS 26, PRICE_WEIGHT_WEEKS 13, PRICE_PRESSURE_PER_UNIT 2, RESULTS_NORMAL_SCORE 8, RESULTS_PRESSURE_PER_POINT 0.25, AWAY_PRESSURE 0.5); used at simulate.ts:2491, 2508-2511, 1844, 2616; onboarding 'twice normal = full' at churn-drivers.ts:312-313`

## 2. Workspace 'utilisation_threshold' setting exists but nothing reads it; engine uses fixed 85%  
*high · engine*

Status: fixed in this branch

- **Now:** docs/PRD.md:223 defines settings.utilisation_threshold default 0.85; it can be written via suggestions/import, shows on the company model, but no code in packages/engine, packages/db/src/model.ts or apps/web reads it.
- **Why it matters:** An owner (or the MCP assistant) who sets 'we're full at 75%' sees it stored and labelled on the company model, but the overload churn driver, the 'too busy' facts and capacity forecasts still use 85%. A field that does nothing.
- **Fix:** Map settings.utilisation_threshold in packages/db/src/model.ts to a new EngineModel field (e.g. loadThreshold) used by loadPressure/runLoadHit in simulate.ts:2508-2511 and as the middle busy cut-off; add a 'Full at (busy %)' NumberField in Settings > People next to overtime cap (people-settings.tsx:43).
- **Where:** `packages/db/src/company.ts:87 (utilisation_threshold label) and packages/db/migrations/20261021000000_roles_and_workspaces.sql:181 (allowed settings key); engine instead uses churn-drivers.ts:291 LOAD_THRESHOLD = 0.85 and ratings.ts:94 busy cutoffs [0.7, 0.85, 0.95]`

## 3. DLER goal is fixed at 4.5 and no setting can change it  
*high · money*

Status: fixed in this branch

- **Now:** Every good/warn tone, the goal line on the DLER charts, the 'At or above the 4.5 goal' text and the Sandbox's 'Departments at the goal' count all compare against the constant 4.5. The owner expects a 3:1 goal.
- **Why it matters:** An agency that aims for 3:1 sees every department marked 'Below the goal' in warning colour even when it is on target, and the Sandbox payoff ('0 of 2 departments at the goal') measures against the wrong bar. The owner can't make the app judge DLER by their own target.
- **Fix:** Add a workspace setting `dler_goal` (Settings > Workspace or Capacity, next to 'DLER includes leadership', default 3 or 4.5), load it into CapacitySetup, and pass setup.dlerGoal to the three components in place of the constant.
- **Where:** `packages/db/src/capacity-figures.ts:43 (export const DLER_GOAL = 4.5). Read at apps/web/src/components/overview/department-cards.tsx:60,244-255,331-349; apps/web/src/components/capacity/capacity-view.tsx:216,241; apps/web/src/components/sandbox/play-results.tsx:125,209-210,277,280`

## 4. The Sandbox has no cost levers: no overheads, pay rise, role cost or hire pay  
*high · money*

- **Now:** Levers C1 'Role cost' (packages/db/src/sandbox-levers.ts:321-337) and C2 'Overheads a month' (:339-354) are defined with offered:true, but only the old SandboxView offers them, and that view is switched off (apps/web/src/lib/sandbox/scenarios-shown.ts:5 SANDBOX_SCENARIOS_SHOWN = false; apps/web/src/app/w/[slug]/sandbox/page.tsx:69 renders PlayPage). The play Sandbox shows profit (play-results.tsx:134-199) but can only change revenue and headcount.
- **Why it matters:** The owner can't try 'what if rent goes up 2k', 'what if we give everyone a 5% raise from July' or 'what if a new hire costs 7k a month'. Profit in the Sandbox only moves with revenue and headcount, so it feels hardcoded.
- **Fix:** Add a 'Costs' group to play-levers.tsx with overheads a month (C2, set/add from a month), pay change % by role from a month (C1 multiply), and a salary field on each hire row. Carry them in PlayState and map them in playChanges to the existing C1/C2 changes.
- **Where:** `apps/web/src/components/sandbox/play-levers.tsx:123-293 (the only groups are Market, Win new clients, Lose clients, Prices, People); packages/db/src/sandbox-play.ts:41-66 (PlayState has no cost field) and :231-246 (playChanges emits only A1, A3, B3, B5, D2, D1, E6)`

## 5. A Sandbox hire costs nothing in profit but counts at the role's average salary in DLER  
*high · money*

- **Now:** When the role has no salary entered (the usual case today) and its default_cost_rate is 0, a hire's labour in the engine is 0, so profit doesn't fall. DLER for the same month divides by the mean salary of the role's people. That mean is not fte-normalised, so a role with part-timers gives a full-time hire a part-time salary. The hire is always fte 1 (sandbox-play.ts:242 value: 1).
- **Why it matters:** 'Hire a PPC specialist in March' shows profit unchanged or up (more capacity, same cost) while DLER drops. The owner gets an over-rosy answer on whether a hire pays for itself, and the profit and DLER tiles disagree.
- **Fix:** Give the hire one salary used by both: in run.ts set the hire row's salary_monthly to the same value setupInMonth computes (fte-normalised mean, or a salary typed on the hire row), so personCost costs it. Show that salary on the hire row in play-levers.
- **Where:** `packages/db/src/sandbox/run.ts:166 (hire PersonRow: cost_rate null, no salary_monthly) -> packages/db/src/model.ts:912-917 personCost (role salary, else nothing) -> packages/engine/src/simulate.ts:3690-3694 rateOf falls back to roles.default_cost_rate, which defaults to 0 (packages/db/migrations/20260929000000_init.sql:53). DLER side: packages/db/src/sandbox-play-series.ts:55-58 gives the hire the mean of the role's people's effective salaries.`

## 6. Most Sandbox levers are hidden: the live Sandbox offers only 9 free-play levers  
*high · sandbox*

- **Now:** The lever registry (packages/db/src/sandbox-levers.ts:154-545) has offered:true levers for Fees (B2), Client value range (A5), Traffic by type (A6), Churn driver chance (B4), Role cost (C1), Overheads (C2), FTE change (D4), Leave (D3), Headcount (D5), Hours available (D6), Hiring delay (D9), Step time/Wait/Rework (E1-E3). They are reachable only through change-dialog.tsx in SandboxView, which the page never shows. Goal seek and the tornado are also off. Free play (play-levers.tsx) has only Market, Leads %, Win %, Win new clients, Churn %, Price %, named client leaves, Someone leaves, Hire.
- **Why it matters:** An owner can't ask 'what if rent goes up 2k', 'what if we pay designers 10% more', 'what if onboarding takes half the time' or 'what if hiring takes 4 months' in the Sandbox. The engine supports all of these, but the page offers none of them, so the Sandbox feels like a fixed demo and not a simulator.
- **Fix:** In the free-play band, add a 'Costs' group (Overheads a month: C2; Role cost / pay: C1), a 'Work' group (Hours available: D6; Step time: E1 for a picked step) and a hiring-delay select (D9), all mapped in playChanges (packages/db/src/sandbox-play.ts:232). Or turn SANDBOX_SCENARIOS_SHOWN on, or put an 'Advanced change' button in play that opens change-dialog.tsx and adds the registry change to PlayState.
- **Where:** `apps/web/src/lib/sandbox/scenarios-shown.ts:5 (SANDBOX_SCENARIOS_SHOWN = false); apps/web/src/app/w/[slug]/sandbox/page.tsx:48-71 renders PlayPage only; apps/web/src/lib/sandbox/analysis-shown.ts:4 (SANDBOX_ANALYSIS_SHOWN = false)`

## 7. Free-play price rise overwrites the price churn driver set in Settings  
*high · sandbox*

- **Now:** When the Price slider is moved, applyPlay replaces the workspace's 'price' churn driver with chance 1, effect = tier price_rise_churn x reaction factor, and a fixed 3-month duration. This drops the chance, effect and 'months' the owner set for the price driver in Settings -> Churn drivers. The saved-scenario path keeps the owner's setting (withPriceDriver, packages/db/src/sandbox/edits.ts:175-183, 'the user's own setting then stands').
- **Why it matters:** An owner who has said 'a price rise hurts for 6 months' in Settings sees the Sandbox price test assume 3 months. Free play and a saved scenario then give different churn and net-revenue answers for the same rise.
- **Fix:** In applyPlay, start from the workspace price driver's own effectMonths (and chance, when set), falling back to 3 only when it has none. Add a 'Lasts N months' select next to 'Clients react' in the Prices group. Let price_rise_churn's help text name the driver's months rather than '3'.
- **Where:** `packages/db/src/sandbox-play.ts:29 (PRICE_RISE_MONTHS = 3) and :281 (entry = {..., enabled: true, chance: 1, effect, effectMonths: PRICE_RISE_MONTHS})`

Status: fixed in this branch

## 8. Client health rules (starting health, on-time boost, late and missed penalties) cannot be edited  
*high · settings*

Status: fixed in this branch

- **Now:** Every workspace runs on 80 / +2 / -5 / -12. The editor exists (HealthSettings, apps/web/src/app/w/[slug]/settings/servicing-settings.tsx:224, saving through saveHealthSetting at servicing-actions.ts:88), but nothing renders it.
- **Why it matters:** Health drives churn: churn = base x (1 + sensitivity x (100 - health)/100). The owner can't say 'our clients forgive a late task' or 'a missed report costs us a lot', so the churn and revenue forecasts run on assumptions they can't see or change. On the tier path a stored health_initial is ignored for counted clients anyway, because capacity-model.ts:203 uses 80.
- **Fix:** Render HealthSettings in Settings (under #simulation or #tiers-clients). In capacity-model.ts:203 and client-groups.ts:38, fall back to settings.health_initial ?? DEFAULT_HEALTH_RULES.initial instead of the literal 80. Optionally add health as a column on named clients. Add Sandbox levers for the health rules (scenario.ts already has HEALTH_RULE_KEYS).
- **Where:** `packages/engine/src/servicing.ts:13 (DEFAULT_HEALTH_RULES = initial 80, recover 2, latePenalty 5, missedPenalty 12); packages/db/src/model.ts:640-649 healthRules(s) reads settings.health_*; packages/db/src/capacity-model.ts:203 hardcodes `health: 80` for a tier group with no row and ignores settings.health_initial; apps/web/src/lib/client-groups.ts:38 placeholder starting_health 80`

## 9. New-starter ramp-up is stored and simulated but has no editor, and the Sandbox points to a Settings field that doesn't exist  
*high · settings*

- **Now:** New hires work at 40%, then 60%, then 80% for three months. saveRampDefault (setup-actions.ts:64) and savePersonRamp (setup-actions.ts:51) exist but no component calls them. saveSetupField refuses the ramp field type outright (setup-actions.ts:43).
- **Why it matters:** Every planned hire in the forecast and every Sandbox 'add a starter' takes the same three-month ramp, whether the hire is a senior contractor or a graduate. Capacity and hire timing come out wrong, and the help text sends the owner to a field that isn't there.
- **Fix:** In Settings > People & roles, add a 'New starter ramp' text field wired to saveRampDefault, and a per-person 'Ramp' field in PersonMore wired to savePersonRamp. Also offer it as a Sandbox lever on hires.
- **Where:** `packages/db/src/capacity-model.ts:24 DEFAULT_RAMP [0.4,0.6,0.8] and :160-163 (people.ramp ?? settings.ramp_default ?? DEFAULT_RAMP); packages/db/src/model.ts:869-874 passes ramp_default; apps/web/src/components/sandbox/play-levers.tsx:310 says 'the ramp in Settings, under People & roles'`

Status: fixed in this branch

## 10. A named client with a blank fee brings in no revenue, though the screen shows the tier's fee as its default  
*high · settings*

Status: fixed in this branch

- **Now:** The Fee cell in tiers-clients.tsx:668-680 shows a blank, with the tier's price as placeholder, whenever mrr is 0. The section text (settings/page.tsx:83) says 'A named client starts from its tier's values; anything filled in replaces them'. The engine then bills 0 for that client.
- **Why it matters:** Each named client added without a fee takes its tier's fee off starting MRR, the forecast revenue and profit, and the value of losing that client. The owner sees the tier fee on screen, so it looks like a calculation bug.
- **Fix:** In engineClients (model.ts:699), use the price of the client's primary tier service when c.mrr is 0 or null, so a blank inherits the tier fee as the UI says. Use the same rule in startingMrr. Alternatively, store null rather than 0 for a blank and treat null as 'use the tier's fee'.
- **Where:** `packages/db/src/model.ts:699 (`mrr: Number(c.mrr)`, no fall back to the service price); packages/engine/src/simulate.ts:2696 bills client.mrr; apps/web/src/lib/overview/projection.ts:65 sums c.mrr; apps/web/src/lib/clients.ts:33 stores a blank MRR as 0`

## 11. A role's utilisation threshold is ignored by the People page, the forecast and the Issues/Overview findings, which use a fixed 85%  
*high · pages*

Status: fixed in this branch

- **Now:** Every role has an editable 'Utilisation threshold %' (roles.line). Capacity, Overview Busiest people, Overview team load and hiring advice use it (packages/db/src/capacity-figures.ts:150-154 over = util >= role.line). But role.line never reaches the engine model (EngineRole has no line field; packages/db/src/model.ts doesn't read it), so the engine's busy rating, forecast alerts ('who gets too busy, and when'), the Issues register's too-busy findings and the People page's 'above 85% busy in a bad month' / red-amber-green bars all use a fixed 85% (amber at 75%).
- **Why it matters:** Owner sets Account Managers to 75%: Capacity and the Overview's team load say they are over from month 2, while on the same Overview the 'Across the company' finding, the People page forecast panel ('Nobody crosses the 85% utilisation threshold') and the Issues page say they are fine until 85%. Setting a role to 95% has the opposite disagreement. The threshold looks like it does nothing on half the app.
- **Fix:** Pass each role's line into the engine model (e.g. EngineRole.line) and have the busy rule/forecastAlerts/firstCrossing use it as the subject's cutoff (or a per-role override in toRatingConfig built from roles.line); make lib/people.ts rate each person against their role's line instead of BUSY_LIMIT, and forecast-panel draw each role's line rather than cutoffs[1].
- **Where:** `apps/web/src/lib/people.ts:17 (BUSY_LIMIT = 0.85, used at :97 and in apps/web/src/components/people-page.tsx:269-270, :449 with a further hardcoded 0.75 warn band); apps/web/src/components/forecast/forecast-panel.tsx:50-52 (busyLine = default cutoffs[1]); apps/web/src/lib/forecast/forecast.ts:49-57 -> packages/engine/src/forecast.ts:123,132 (firstCrossing uses resolved.cutoffs, not the role's line); apps/web/src/components/overview/overview.tsx:231,235 (forecastFindings with ANALYSIS_DEFAULTS); apps/web/src/components/issues-page.tsx:295; defaults at packages/engine/src/ratings.ts:94 busy: [0.7, 0.85, 0.95]`

## 12. DLER goal fixed at 4.5 everywhere  
*high · pages*

Status: fixed in this branch

- **Now:** Every DLER tile, bar, status colour ('Below the 4.5 goal') and the Sandbox's 'Departments at the goal' count is judged against a constant 4.5.
- **Why it matters:** An agency whose target DLER is 3.0 (or 5.0) sees every department flagged warn/good wrongly on Overview, Capacity and the Sandbox, and the Sandbox's 'reach the goal' verdict is measured against someone else's benchmark.
- **Fix:** Add workspaces.settings.dler_goal (Settings > Workspace details or the DLER area in Settings > People, next to 'DLER includes leadership'), default 4.5, and thread it through CapacitySetup to dlerStatus, the DLER bar, capacity-view and play-results.
- **Where:** `packages/db/src/capacity-figures.ts:43 (export const DLER_GOAL = 4.5); used at apps/web/src/components/overview/department-cards.tsx:60,244-255,331,349; apps/web/src/components/capacity/capacity-view.tsx:216,241; apps/web/src/components/sandbox/play-results.tsx:125,209-210,277,280`

## 13. Overtime is costed at straight-time rate; no overtime premium setting  
*medium · engine*

- **Now:** Every overtime hour costs exactly the person's normal hourly rate (rateOf, simulate.ts:3689-3694). No multiplier (e.g. 1.5x) and no option for salaried staff whose overtime is unpaid (cost 0).
- **Why it matters:** Profit in a busy scenario is wrong in either direction: too optimistic where overtime is paid at time-and-a-half, too pessimistic where salaried staff absorb it unpaid. Comparing 'hire vs work overtime' in the Sandbox is skewed.
- **Fix:** Settings > People: add 'Overtime paid at' (x normal rate, default 1, 0 = unpaid) to workspace settings; pass as EngineModel.overtimeRateFactor from packages/db/src/model.ts:362 and multiply at simulate.ts:3774 and 3955.
- **Where:** `packages/engine/src/simulate.ts:3774 (overtimeCostM[m] += ot[m] * rate) and simulate.ts:3955 (overtimeCost += ot * (paid.cost / paid.payHours or rateOf(p)))`

## 14. No Sandbox lever for overtime cap (or availability floor / new-starter ramp)  
*medium · engine*

- **Now:** Overtime cap is editable only in Settings (people-settings.tsx:43). The Sandbox offers Hire, Leave, FTE change, Hours available, Hiring delay, but not 'let the team work up to N% overtime'.
- **Why it matters:** The most common owner question in a crunch ('what if we just do overtime for 3 months instead of hiring?') cannot be tried in the Sandbox without changing live Settings.
- **Fix:** Add a group-D lever 'Overtime allowed' (set/add, 0-50%, timed by month) with patchPath settings.overtime_cap, mapped in packages/db/src/sandbox and model.ts:362; optionally a ramp-months lever for hires.
- **Where:** `packages/db/src/sandbox-levers.ts:154-598 (lever list A1..E6, X1..X3: no overtime, availability or ramp lever); engine reads model.overtimeCap at simulate.ts:902`

## 15. Client health rules and churn sensitivity are Sandbox levers marked offered:false  
*medium · engine*

Status: fixed in this branch (free play: one lever per health rule, and churn sensitivity as a percent; the scenario dialog still does not offer them)

- **Now:** Both are wired through to the engine (patchPath health.* and services.*.churn_health_sensitivity; HEALTH_RULES at sandbox-levers.ts:716) but only kept 'for migrated rows' and never offered.
- **Why it matters:** An owner cannot test 'what if clients forgive a late report less (penalty 10 instead of 5)?' or 'what if our clients are less health-sensitive?' as a scenario; they must change live Settings, which changes the Overview for everyone.
- **Fix:** X1 has range:{} and the target 'health_rule', which covers several fields with different units. Offering it needs one lever per rule field (starting health, late penalty, missed penalty, recovery) with ranges for each, not just flipping offered:true.
- **Where:** `packages/db/src/sandbox-levers.ts:549-563 (X1 'Client health rule', offered:false) and sandbox-levers.ts:584-598 (X3 'Churn sensitivity to health', offered:false)`

## 16. Client start date is ignored: every existing client counted as brand new  
*medium · engine*

Status: fixed in this branch

- **Now:** clients.start_date is editable, but model.ts uses it only to drop future clients. monthsActive is never set, so the value of losing a client is always fee x min(tenure, 12) as if month 0, and the early-tenure churn driver never applies to roster clients who joined last month.
- **Why it matters:** The cost of churn findings overstates the loss on long-standing clients, and a client signed two weeks ago is treated like a five-year client for churn risk. The owner enters the date and it changes nothing.
- **Fix:** In packages/db/src/model.ts clients mapping, set monthsActive from start_date to the run start; in simulate.ts driveClient apply early tenure to roster clients whose since-start (minus monthsActive) is within the early-tenure window.
- **Where:** `packages/db/src/model.ts:693-704 (EngineClient built without monthsActive); engine/src/cost.ts:114 (client.monthsActive ?? 0); simulate.ts:2489 (early tenure only when !rc.roster)`

## 17. A person's 'Cost rate' overrides their salary for profit, while DLER keeps using the salary  
*medium · money*

- **Now:** Both fields can be edited for the same person: 'Cost rate' (apps/web/src/app/w/[slug]/settings/people-settings.tsx:198-207, shown in the Set up person panel via people-roles.tsx:462) and 'Salary a month' (people-roles.tsx:477). The engine's labour, overtime and profit use the cost rate. DLER, the missing-salary list and Sandbox hires use the salary. The cost-rate help says 'The simulation uses it to cost overtime', but it actually prices all paid hours.
- **Why it matters:** An owner who enters a salary of 6,000 for someone who once had a 35/h cost rate sees DLER move but profit stay the same. Two pay figures for one person disagree with no warning, and the help text misleads.
- **Fix:** Use one source of pay. Either drop 'Cost rate' for salaried staff (keep it only for contractors) or show the salary-derived hourly cost as the cost-rate placeholder and warn when both are set. Fix the help text to say it costs all paid hours.
- **Where:** `packages/db/src/model.ts:913 (personCost: `if (p.cost_rate != null) return { cost: Number(p.cost_rate) }` before any salary); packages/db/src/capacity-figures.ts:455 (DLER uses personSalary, never cost_rate)`

## 18. Sandbox DLER for today's path doesn't match the Overview/Capacity DLER  
*medium · money*

Status: fixed in this branch

- **Now:** Overview DLER (capacity-view.tsx:213, department-cards.tsx via wholeBusiness) credits nobody with counted clients that sit in a group but in nobody's portfolio, nor with non-tier retainers. The Sandbox puts all of the engine's MRR into the department pools, including unheld counted clients, non-tier services and the market price factor, and shares it across the client-facing people. The fee map at line 104 still prices counted clients at service.price.
- **Why it matters:** With no lever moved, the Sandbox's month-1 DLER is higher than the DLER on the Overview and Capacity pages, so the owner can't trust either number.
- **Fix:** Use one definition. Either have the Overview credit unheld counted clients to the department pool the way the Sandbox does, or have playSeries scale each person's today-fee by the engine's change in that department's MRR, so that month 0 equals dler(setup).
- **Where:** `packages/db/src/sandbox-play-series.ts:101-117 (the department pool is the engine's whole monthly MRR shared out by clients x fee) vs packages/db/src/capacity-figures.ts:411-431 personFees (Overview/Capacity: only portfolio counts x price plus named clients each person manages)`

## 19. Overtime is always paid at the normal hourly rate (1x), even for salaried staff  
*medium · money*

- **Now:** Overtime hours are costed at exactly the person's ordinary rate. There is no premium (1.5x, 2x), and no option for salaried staff whose overtime is unpaid (0x). It always comes off profit at 1x.
- **Why it matters:** Profit in the forecast and the Sandbox is wrong in both directions. It is too low for agencies that don't pay overtime to salaried staff, and too high for ones that pay time-and-a-half. 'Overtime cost' is a real line in the money table (forecast-money.tsx:32).
- **Fix:** Add 'Overtime pay rate' (x normal rate, default 1, 0 = unpaid) next to the overtime cap in Settings > Simulation, map it to EngineModel.overtimePayFactor, and multiply it in at the two sites.
- **Where:** `packages/engine/src/simulate.ts:3774 (`overtimeCostM[m] += ot[m] * rate`) and :3955 (`overtimeCost += ot * (paid.cost / paid.payHours || rateOf(p))`)`

## 20. Contractors are costed like employees: paid for contracted hours, including leave  
*medium · money*

- **Now:** A person labelled 'contractor' (capacity-setup.ts:72,379) is left out of DLER and gets no role salary, but the engine charges them capacity x rate every month, worked or not, with leave paid, just like staff.
- **Why it matters:** An agency that uses freelancers by the hour sees profit fall by their full contracted hours even in quiet months, and the Sandbox can't show the saving from flexing contractors down.
- **Fix:** Pass the label to EnginePerson (e.g. `paidFor: 'worked'` for contractors) and cost those people on hours worked (personWork) with no paid leave. Optionally add a per-person 'Paid for: contracted hours / hours worked' toggle.
- **Where:** `packages/engine/src/simulate.ts:3764-3770 ('Paid hours are contracted capacity while on the team (leave is paid)') and :3708-3722 paidOver; packages/db/src/capacity-model.ts:20 (the people label is 'Not an engine input at all')`

## 21. Salary becomes hourly cost with no employer on-costs (super, payroll tax, benefits)  
*medium · money*

- **Now:** The cost of an employee's hour is gross salary / hours, loaded by 0%. Superannuation (11.5%+ in AU), payroll tax, insurance and benefits never reach labour cost or profit unless the owner folds them into overheads by hand.
- **Why it matters:** Profit is overstated by roughly 12-20% of payroll, and a hire looks cheaper in the Sandbox than it really is.
- **Fix:** Add a workspace 'Employer on-costs %' (Settings > Workspace, default for example 12%) applied in hourlyCostFromSalary for non-contractors. Optionally use the loaded salary in DLER too, with a toggle.
- **Where:** `packages/db/src/salary.ts hourlyCostFromSalary (`monthly / (weeklyHours * WEEKS_PER_MONTH)`), used by packages/db/src/model.ts:916`

## 22. Hiring delay is fixed at 2 months, and the Sandbox ignores the market stretch the Overview applies  
*medium · money*

- **Now:** The 'start hiring by' advice uses 2 months x the market's hire factor on the Overview, but a flat 2 months in the Sandbox. The comment at capacity-figures.ts:31 mentions a Sandbox 'Hiring delay' lever, but play-levers.tsx has none.
- **Why it matters:** For the same workspace, the Overview and the Sandbox advise different hire-by months, and an agency that takes 3-4 months to hire is told it has more time than it does.
- **Fix:** Add a 'Months to hire' workspace setting (and optionally a Sandbox People lever). Pass it, wrapped in hiringDelayAt with the run's market, from use-play-runs to playSeries, as the Overview does.
- **Where:** `packages/db/src/capacity-figures.ts:34 (DEFAULT_HIRING_DELAY_MONTHS = 2); apps/web/src/lib/sandbox/use-play-runs.ts:80,108 call playSeries(...) with no delay, so sandbox-play-series.ts:86,129 uses a flat 2; apps/web/src/components/overview/overview.tsx:329 passes hiringDelayAt(horizonModel.market, m)`

Status: fixed in this branch

## 23. Sandbox 'when to hire' uses a flat 2-month hiring delay, Overview stretches it by the market  
*medium · sandbox*

- **Now:** Sandbox hiring advice always assumes 2 months from 'decide to hire' to 'start'. The Overview passes (m) => hiringDelayAt(horizonModel.market, m), which scales the delay by the market's 'time to hire' factor (apps/web/src/components/overview/overview.tsx:329). Neither page lets the owner set the base 2 months.
- **Why it matters:** With a tight-hiring market set, the Overview says 'hire by March' and the Sandbox says 'hire by May' for the same company. An agency whose recruiting takes 3-4 months can't make either page say so.
- **Fix:** Add 'Months to hire' to Settings -> People & roles (a workspace setting). Feed it as the base to hiringDelayAt in both the Overview and playSeries (pass (m) => hiringDelayAt(model.market, m, base) from use-play-runs.ts). Offer D9 in free play.
- **Where:** `packages/db/src/sandbox-play-series.ts:86 and :129 (hiringAdvice(setup, result, hiringDelay) with default DEFAULT_HIRING_DELAY_MONTHS); apps/web/src/lib/sandbox/use-play-runs.ts:80,108 call playSeries without a delay; packages/db/src/capacity-figures.ts:34 (DEFAULT_HIRING_DELAY_MONTHS = 2)`

Status: fixed in this branch

## 24. Free-play sliders cap realistic changes (leads/win ±50% in 5s, price -20..+30%, 50 wins a month)  
*medium · sandbox*

- **Now:** Leads and win rate can't be doubled or set to +3%. Price can't rise more than 30%, which matters for an agency repricing an underpriced tier. The registry itself allows A1/A3 multiply 0-5 (sandbox-levers.ts:163,178) and B5 -100%..+400% (:282).
- **Why it matters:** Common owner questions ('what if we double our lead flow with a new channel?', 'what if we raise the Starter tier 50%?', 'what if win rate goes up 2 points?') can't be entered, so the answer looks capped or wrong.
- **Fix:** Widen the sliders to the registry ranges (leads/win -90..+300% with step 1, price -50..+100% with step 1), or pair each slider with a number input that accepts any value in the registry range.
- **Where:** `apps/web/src/components/sandbox/play-levers.tsx:143-144 (Leads, Win rate: min -50 max 50 step 5), :204 (Churn -50..100), :244 (Price change -20..30 step 1), :157-161 (Win new clients 0..50 per department), :173 (For: 1,2,3,6,9,12 months)`

Status: fixed in this branch

## 25. Free-play hires are always 1 FTE, at an averaged salary, and named 'New hire'  
*medium · sandbox*

- **Now:** A hire in play is a full-time person on the mean salary of current role members. The owner can't pick part-time (the dialog's HIRE_FTE.offered allows 0.1-1.5, sandbox-levers.ts:122) or enter the pay the new person would get.
- **Why it matters:** 'Hire a 0.5 FTE senior at $9k a month' can't be tested. DLER and profit for a hire reflect someone else's average pay, not the offer the owner is weighing.
- **Fix:** Add an FTE select (0.2-1.5) and an optional 'Pay a month' input to each play hire row. Store them in PlayState.hires and pass FTE as the D1 value and pay to setupInMonth (and to the engine's cost when person salary feeds profit).
- **Where:** `packages/db/src/sandbox-play.ts:242 (D1 change value: 1); packages/db/src/sandbox-play-series.ts:54-72 (fte: 1, salary_monthly = mean of the role's people, name 'New hire')`

## 26. Lever months stop at month 12 even on a 3-5 year horizon  
*medium · sandbox*

- **Now:** The horizon picker offers 12-60 months (play-types.ts:30), but every 'from' or 'in' month picker (market, price, hires, leavers, named client leaves, map versions) lists only the first 12 months. Saved scenarios are capped at 24 months (sandbox-levers.ts:120 MAX_HORIZON_MONTHS) and 6 change months (:114).
- **Why it matters:** On a 36-month plan, an owner can't plan a hire in month 18, a price rise in year 2 or a market downturn starting in month 15. The long horizon shows only the after-effects of year-one moves.
- **Fix:** Pass the full horizon's months to the lever month pickers and make clampMonth, winEntries and marketFrom use the run's months (the horizon) instead of PLAY_MONTHS.
- **Where:** `packages/db/src/sandbox-play.ts:128 (clampMonth caps at PLAY_MONTHS - 1 = 11), :158 (addMonths <= 12), :259 (market schedule built for 12 months only); apps/web/src/components/sandbox/play-view.tsx:79 (leverMonths = first year unless horizon is 12)`

Status: fixed in this branch

## 27. Client health rules and ongoing hours per client are editable in Settings but have no Sandbox lever  
*medium · sandbox*

Status: partly fixed in this branch: the health rules have free-play levers; client hours per client (X2) still has none

- **Now:** Starting health, recovery, and late and missed penalties (X1), and the ongoing hours a client needs from a role (X2), are registry levers kept 'for migrated rows', never offered and with no ranges. Churn sensitivity to health (X3) is the known case.
- **Why it matters:** The owner can't test 'if we stop missing deadlines' (smaller penalties) or 'if each client needed 2 fewer account hours a week'. These are the service-quality and efficiency questions that drive retention and capacity.
- **Fix:** Give X1 and X2 ranges (penalty 0-50 points step 1; ongoing hours multiply 0.1-2 step 0.05) and offered:true. In free play, add a 'Service' group with 'Late penalty' and 'Account hours per client %' sliders.
- **Where:** `packages/db/src/sandbox-levers.ts:548-599 (X1 Client health rule, X2 Client hours per client: offered:false, range {})`

## 28. Working hours per week can't be changed after the workspace is created  
*medium · settings*

- **Now:** Set once in the new-workspace form (apps/web/src/app/new-workspace-form.tsx:118, lib/workspaces.ts:37). The default is 40.
- **Why it matters:** If the agency's normal week is 37.5 or 38 hours (common in AU and UK), or the creator entered the wrong number, every person without their own 'Hours a week' has the wrong capacity. Leave, utilisation and salary-to-hourly cost all go wrong, and the only fix is a new workspace.
- **Fix:** Add a 'Normal working week (hours)' field to Settings > Simulation, saving settings.hours_per_week with the same 1-168 rule as lib/workspaces.ts.
- **Where:** `packages/db/src/model.ts:344 (hoursPerWeek: s.hours_per_week); model.ts:851 (hoursPerDay for leave); model.ts:880 (capacity = fte x hours_per_week when a person has no own hours)`

Status: fixed in this branch

## 29. Services that aren't tiers still simulate but can't be seen, edited or added in Settings  
*medium · settings*

- **Now:** ServicesSettings (services-settings.tsx:51) and ClientGroupsSettings (client-groups-settings.tsx:76) are not rendered anywhere. ServiceMore appears only under a tier's More row (tiers-clients.tsx:299).
- **Why it matters:** A project or hourly service keeps its stored price, churn, mix share (its share of leads) and its client-group count, fee and churn. These change revenue and how leads are split, and the owner can only see a count of how many such services exist. They can't change a project's price, pause it or add one.
- **Fix:** In Settings > Tiers & clients, add an 'Other services' list that reuses ServiceMore and GroupFields (or render ServicesSettings with tierServiceIds) for services with no tier, including Add and Remove.
- **Where:** `apps/web/src/components/setup/tiers-clients.tsx:104-111 (a comment says 'D46: services that aren't tiers ... are not edited here', and a note says they 'still count in the simulation'); packages/db/src/model.ts:536-575 engineServices maps every active service (price, churn, tenure, mix share, fee range, fallback load)`

Status: fixed in this branch

## 30. Client lifetime value uses 'Expected tenure', which is separate from churn and hidden under More  
*medium · settings*

Status: fixed in this branch

- **Now:** The tier table edits 'Churn a month' (tiers-clients.tsx:272), but deal value, lost-client cost and lost revenue use services.tenure_months, or client_groups.stay_months when a group row exists. Tenure is editable only under the tier's More panel (services-settings.tsx:221). Nothing ties it to 1/churn, though the implicit retainer does exactly that (simulate.ts:439).
- **Why it matters:** Example: an owner lowers churn from 5% to 2% a month (implied stay 20 to 50 months). The simulation keeps clients longer, but every value of a won deal or a lost client still uses the old 18-month tenure, so the money figures and the churn figures tell different stories.
- **Fix:** Derive tenure from churn by default (1/churn, capped) and treat Expected tenure as an optional override, or show tenure next to churn in the tier table with a warning when the two disagree.
- **Where:** `packages/engine/src/simulate.ts:447-455 (winValue = price x tenureMonths); packages/engine/src/clients.ts:223 (a group's stayMonths replaces tenure); packages/db/src/model.ts:551-552 maps tenure_months and churn_monthly_base on their own`

## 31. Named clients' own words, links, tech hours, builds, creative sets and effort factor reach the engine but have no field  
*medium · settings*

- **Now:** The named-client row edits only channels, hand-holding hours, ad-hoc chance, requests and size, and meetings (tiers-clients.tsx:558 and 681-689). words, links, tech_hours, builds, creative_sets and step_factor have no input.
- **Why it matters:** The owner can't say 'Harbourline gets twice the content of a normal Tier 1 client' or 'this client takes 1.5x the time on every task'. Big or demanding clients are simulated as average tier clients, so the capacity and busy figures for their managers come out low.
- **Fix:** In the named client's More panel (ClientMore), add the department's deliverable columns (tierFieldsFor) as override cells with the tier's value as placeholder, plus an 'Effort factor' (step_factor, 0.01-20).
- **Where:** `packages/db/src/capacity-model.ts:126-139 engineClientCapacity maps every deliverable plus step_factor into EngineClient.overrides; packages/db/src/capacity-setup.ts:62-64 CLIENT_OVERRIDE_COLUMNS and :465-479 SETUP_FIELDS.clients allow saving them`

Status: fixed in this branch

## 32. Analysis assumptions (absence test length/frequency, lost-client value cap, busy cutoffs, expected waits) are locked to defaults and stored rules are ignored  
*medium · pages*

Status: fixed in this branch (the value cap, the absence test and the busy bands are in Settings > Simulation; the expected waits stay at their defaults)

- **Now:** Every page rates with the documented defaults: a lost client is worth at most 12 months of fees, the 'If someone is away' test is a 2-week absence twice a year, busy is 70/85/95%, expected waits 1 and 2 days. The defaults.ts comment says what a workspace stored in analysis_rules 'is kept, unread'.
- **Why it matters:** An owner whose staff take 4 weeks' leave or whose clients stay 3 years can't make the People page's absence test or the money-at-risk figures match their business; any rules saved before the editor was removed silently stop applying (two sources of truth).
- **Fix:** Expose at least capMonths, absenceWeeks and absencesPerYear in Settings (a small 'Assumptions' section) and read loadAnalysisRules in the pages instead of ANALYSIS_DEFAULTS; or delete the unread analysis_rules data so nothing pretends to be stored.
- **Where:** `apps/web/src/lib/analysis/defaults.ts:8 (ANALYSIS_DEFAULTS = {}), used at apps/web/src/components/overview/overview.tsx:231-232, apps/web/src/components/people-page.tsx:112,127, apps/web/src/components/issues-page.tsx:295, apps/web/src/components/forecast/forecast-panel.tsx:50-52, apps/web/src/components/sandbox/sandbox-view.tsx:206; values at packages/engine/src/analysis-settings.ts:157 (capMonths 12, absenceWeeks 2, absencesPerYear 2) and packages/engine/src/ratings.ts:93-106,170`

## 33. Hiring lead time is a fixed 2 months on the Overview and in Play, but 0 in the Sandbox's own run, with no setting  
*medium · pages*

- **Now:** 'Hire by' advice on the Overview assumes 2 months x the market's time-to-hire; the Sandbox Play page's advice assumes a flat 2 months; actual simulated hires in a Sandbox scenario start with 0 delay (D9 'starts from none'). The comment admits 'The workspace stores no base of its own'.
- **Why it matters:** The Overview tells the owner to start hiring in March, the Play page says April for the same role when the market slows hiring, and a Sandbox hire shows up immediately; an agency that hires in 1 month or 4 months gets wrong 'hire by' dates everywhere.
- **Fix:** Add workspaces.settings.hiring_delay_months (Settings > People or Demand/market), default 2; use it as the base in hiringDelayAt on the Overview, pass it (with the market stretch) into playSeries, and make D9's 'today' value and default start from it.
- **Where:** `packages/db/src/capacity-figures.ts:34 (DEFAULT_HIRING_DELAY_MONTHS = 2), :37-41; apps/web/src/components/overview/overview.tsx:329 (hiringAdvice with hiringDelayAt(market) base 2, market-stretched); apps/web/src/lib/sandbox/use-play-runs.ts:80,108 -> packages/db/src/sandbox-play-series.ts:86,129 (playSeries default 2, not market-stretched); packages/db/src/sandbox/run.ts:141-151 (scenario hires start with no delay unless lever D9 is set)`

Status: fixed in this branch. Saved scenarios' hires wait the setting once it is set; with it blank they still start on their own date (as before), while the hiring advice uses the default. Free play's hires start in the month picked for them.

## 34. Client health bands (75/65/50) and the 'at risk below 50' line are fixed  
*medium · pages*

Status: fixed in this branch

- **Now:** Healthy/Watch/At risk counts on the People page, client-group ratings, the at-risk counts the engine reports per month, the churn issues' text and the agency list's 'client groups at risk' (apps/web/src/lib/overview/headline.ts:33) all use 75/65/50.
- **Why it matters:** An owner who changes starting health to 60 (or penalties) to match their own health score instantly has most clients 'at risk' because the bands didn't move with the scale; the benchmark they set doesn't change the bands either.
- **Fix:** Add 'At risk below' and 'Healthy from' fields next to the health rules in Settings > Servicing (save_health_rules already writes that area), carry them in model.health, and use them in simulate.ts, clientHealthSummary and churn-issues.
- **Where:** `packages/engine/src/ratings.ts:381 (CLIENT_HEALTH_CUTOFFS = [75, 65, 50]); packages/engine/src/servicing.ts:19 (AT_RISK_HEALTH = 50) used in packages/engine/src/simulate.ts:3659,4024,4332 and packages/engine/src/churn-issues.ts:33,75,139; People page ClientHealthCard via clientHealthSummary (packages/engine/src/clients.ts:321) called at apps/web/src/components/people-page.tsx:123`

## 35. People page busy % disagrees with Capacity/Overview busy % for the same person  
*medium · pages*

Status: fixed in this branch (same threshold and margin as Capacity; the People page says its figure is over the picked length with new clients)

- **Now:** The People page 'How busy' average comes from a different run (different model, horizon and replication count) than Capacity's and the Overview's Busiest people, and is rated against 85%/75% rather than the role's line (see first finding).
- **Why it matters:** The owner sees Sam at 82% on Capacity and 91% on People and can't tell which is true.
- **Fix:** Have the People page either show the Capacity Today run's busy share (useCapacityRuns) or label its figure as 'over the next N months with new clients'; at minimum use the same threshold.
- **Where:** `apps/web/src/components/people-page.tsx:99-102 (useSimulation(model) on the full model at the picked horizon, 30 reps, leads and churn on) vs apps/web/src/components/overview/department-cards.tsx:125-126 and apps/web/src/lib/capacity/runs.ts:10-11 (todayModel: leads and churn off, 12 months, TODAY_REPS 10)`

## 36. 5-day working week hardcoded; 'working_days' setting ignored  
*low · engine*

- **Now:** Every 'working day' conversion divides the week by 5. settings.working_days exists (packages/db/src/company.ts:80 'Working days a week', PRD.md:222) but no code reads it.
- **Why it matters:** For a 4-day-week or 6-day agency, 'normal first delivery in 10 working days', SLA days and wait days are all converted wrong, which moves onboarding churn and every days-based figure.
- **Fix:** The fix should also replace the WORKING_DAYS_PER_WEEK constant at packages/db/src/model.ts:32/840 (the leave and start-date hour conversions) and packages/db/src/sandbox/months.ts:40. Those are on top of the engine and web '/ 5' sites.
- **Where:** `packages/engine/src/simulate.ts:1776 (onbNormalHours = days x hoursPerWeek / 5), simulate.ts:4033; also issues.ts:181, forecast.ts:98, bottlenecks.ts:82, analysis-settings.ts:404 (hoursPerDay = hoursPerWeek / 5)`

Status: fixed in this branch. Every hours-to-days conversion reads the working days. Dates still map onto the run's clock as Monday-to-Friday weekdays (`CALENDAR_WEEKDAYS`), so start dates, leave and month edges are unchanged; which weekdays a shorter week leaves out is not modelled.

## 37. Pooled (no client list) runs decay starting clients at the hidden workspace churn, while new wins use the service's 'Normal churn'  
*low · engine*

Status: still open. Making the pooled book churn at the services' base churn changes every pooled workspace's forecast without an edit, so it waits for the owner's sign-off.

- **Now:** With services but no named clients or client groups, the starting book loses clients at settings.churn_monthly ('Monthly churn (interim)', company.ts:92), while clients won during the run churn at each service's churn_monthly_base.
- **Why it matters:** Before an owner adds client groups, editing a service's churn changes only new clients; the existing book (most of the MRR) keeps churning at an invisible interim rate. Same type of two-sources problem as the tier churn bug.
- **Fix:** In pooled mode, decay the starting clients at the mix-weighted service churn (like pooledMonthlyFee does for the fee, simulate.ts:411-419) when services exist, and use the same rate in projection.ts:104; keep settings.churn_monthly only for service-less workspaces.
- **Where:** `packages/engine/src/simulate.ts:2568 (active *= weeklyKeep(model.churnMonthly ...)) vs simulate.ts:2919 (won retainers billed with sv.s.churnMonthly); Overview mirrors the workspace rate at apps/web/src/lib/overview/projection.ts:104`

## 38. Client-health bands, 'at risk' line and money assumptions for findings are fixed  
*low · engine*

Status: partly fixed in this branch: the at-risk line and bands are settings; the 12-month lost-client cap, the absence assumptions and missed = 2x SLA stay fixed

- **Now:** Clients-at-risk KPI (simulate.ts:3659, 4024), health ratings and churn-risk findings use fixed bands. A lost client's value is capped at 12 months, absence tests assume 2 weeks twice a year, and a task is 'missed' at twice its SLA. These were editable as analysis rules before decision D40, which removed the editor.
- **Why it matters:** An agency with long-tenure clients sees churn cost understated by the 12-month cap; one that treats health 60 as at risk sees too few at-risk clients. Lower priority because D40 fixed these on purpose, but they are business assumptions.
- **Fix:** Optional: add a small 'Assumptions' block in Settings (at-risk health, lost-client value cap in months, missed = N x SLA) stored in workspace settings and passed via toRatingConfig/resolveMoney and EngineHealthRules; or record in PRD that they stay fixed.
- **Where:** `packages/engine/src/servicing.ts:19 AT_RISK_HEALTH = 50; ratings.ts:381 CLIENT_HEALTH_CUTOFFS [75,65,50]; churn-issues.ts:104 clientHealthSummary(model, result) with no cutoffs; analysis-settings.ts:157 DEFAULT_MONEY {capMonths 12, absenceWeeks 2, absencesPerYear 2}; missed task = 2 x SLA at simulate.ts:2765`

## 39. The market 'pay' factor (Downturn pay 1.35) changes no simulated cost  
*low · money*

- **Now:** The Sandbox Market lever (play-levers.tsx:127) picks Boom/Soft/Downturn, whose factors include pay 0.9/1.15/1.35. Workspace market conditions also store a pay column (restore/empty.ts, market_conditions.pay). Labour cost ignores all of it.
- **Why it matters:** Picking 'Downturn' moves revenue, churn and leads, but staff costs never respond to the market, so profit under a market scenario is only half simulated.
- **Fix:** Multiply rateOf by the month's market pay factor (as price already scales won fees), or remove pay from the presets and stored conditions so it doesn't look like it does something.
- **Where:** `packages/engine/src/market.ts:16 ('hire, pay stored and exposed, but ... change no simulated number') and :61-64 presets; rateOf at packages/engine/src/simulate.ts:3690-3694 never reads mkt(t).pay`

## 40. Revenue per employee counts heads, not FTE, and always leaves leadership out  
*low · money*

Status: fixed in this branch

- **Now:** A 0.4 fte part-timer counts as a whole employee. Leadership is always excluded, while DLER has its own toggle (dlerIncludesLeadership, capacity-figures.ts:399-401). People whose role has no department (shared roles) aren't counted anywhere.
- **Why it matters:** Agencies with part-timers or a shared ops team see misleading MRR per person, and the leadership choice made for DLER doesn't carry over to it.
- **Fix:** Divide by summed fte (or offer 'heads / FTE'), and follow the same leadership setting as DLER (or a separate one).
- **Where:** `packages/db/src/capacity-figures.ts:489-500 (perEmployee `.filter(...).length`) and :902 (wholeBusiness)`

## 41. The service 'Margin' field is editable but feeds nothing  
*low · money*

- **Now:** Settings > Services has a Margin field (apps/web/src/app/w/[slug]/settings/services-settings.tsx:211-219). Its hint admits that profit ignores it. Non-labour delivery costs (media, freelancer pass-through, tools per client) have nowhere else to go except overheads.
- **Why it matters:** An editable number that does nothing adds to the 'it's hardcoded' feeling, and the owner can't model per-client direct costs that scale with clients.
- **Fix:** Either remove the field, or repurpose it as a direct cost per client (a share of the fee, or an amount a month) that the engine subtracts in profit with each client.
- **Where:** `packages/engine/src/model.ts:143-144 ('recorded for reference, not used'); mapped at packages/db/src/model.ts:550`

## 42. Sandbox splits revenue by department using the service price, not the client group fee  
*low · sandbox*

Status: fixed in this branch

- **Now:** Department retainers, and so the Sandbox's per-department DLER, weight each counted (unnamed) client at the service Price. The engine bills counted clients at their group fee (EngineClientGroup.fee).
- **Why it matters:** When a tier's group fee differs from its list price (legacy clients on old rates), the Sandbox's department DLER and retainers chart split revenue wrongly between departments and disagree with Capacity and Overview.
- **Fix:** Add fee to the client_groups select in capacity-setup.ts:254 and SetupGroup, then use the group fee in place of s.price in sandbox-play-series.ts:103.
- **Where:** `packages/db/src/sandbox-play-series.ts:100-115 (fee per service = named clients' MRR + (count - named) x s.price)`

## 43. A role's 'hours per client a week', the pooled client load, can't be edited  
*low · settings*

- **Now:** It comes from the stored column, 0 by default. The Ongoing load help text says 'None set: each client needs every role's hours per client a week instead (the pooled estimate)' (services-settings.tsx:340), but no screen edits that number.
- **Why it matters:** In a workspace without servicing processes or per-service loads, client work per role is fixed at whatever was imported, often 0. The simulator then shows the team as having free time it doesn't have, and the owner can't correct it.
- **Fix:** Add 'Hours per client a week' to the role panel in Settings > People & roles (and to SETUP_FIELDS.roles), next to the role cost rate that is being added.
- **Where:** `packages/db/src/model.ts:323 (ongoing: role.ongoing_hours_per_client_week); packages/engine/src/clients.ts:43-48 applies it to every client whose services have no servicing process or fallback load; simulate.ts:1478, 1607 and 1620`

Status: fixed in this branch

## 44. The client health benchmark can't be set, and the People page links to a Settings anchor that doesn't exist  
*low · settings*

- **Now:** ClientHealthBenchmark (client-groups-settings.tsx:156) and saveClientHealthBenchmark (actions.ts:274) exist, but the component is rendered only inside ClientGroupsSettings, which is never rendered. Any workspace without a stored benchmark shows none.
- **Why it matters:** The People page's 'is our client health good?' card asks the owner to enter a range in Settings, and they can't. The comparison stays empty or keeps an imported value.
- **Fix:** Render ClientHealthBenchmark in Settings > Tiers & clients (or Simulation) and point the People page link at that anchor.
- **Where:** `apps/web/src/components/people-page.tsx:104 (benchmarkOf(settings)) and :238 (link to settings/clients#clients-heading); apps/web/src/components/setup/tiers-clients.tsx:105 (a comment says the benchmark is not edited here)`

Status: fixed in this branch

## 45. A lost client's value is fixed at 12 months of fees, and stored analysis settings are ignored  
*low · settings*

Status: fixed in this branch

- **Now:** Every workspace values a lost deal or churned client at no more than 12 months of fees and assumes a two-week absence twice a year. The analysis_rules table is loaded by packages/db/src/analysis-rules.ts but never applied.
- **Why it matters:** The 'cost per month' on every finding and the value of a churned client use a 12-month cap that may not fit the agency. Long-tenure retainers are undervalued and one-off-heavy agencies overvalued, and the code comment wrongly claims it is editable.
- **Fix:** Add a 'Value a lost client at up to N months of fees' field (1-60) to Settings > Simulation, stored in analysis_rules.settings.money.capMonths, and pass it through instead of ANALYSIS_DEFAULTS.
- **Where:** `apps/web/src/lib/analysis/defaults.ts:1-8 (ANALYSIS_DEFAULTS = {} and 'What a workspace stored in analysis_rules is kept, unread'); packages/engine/src/analysis-settings.ts:157 DEFAULT_MONEY {capMonths 12, absenceWeeks 2, absencesPerYear 2}; packages/engine/src/cost.ts:5 says 'capped at 12 months (editable)'`

## 46. A service's 'Margin' field changes nothing  
*low · settings*

- **Now:** Editable 0-100% under More (services-settings.tsx:210-220), with the hint 'Recorded for reference. Profit is worked out from the hours people are paid for, not from this.'
- **Why it matters:** The owner can enter a 40% target margin and expect profit or pricing to follow. Nothing moves, which feeds the 'fields that do nothing' feeling.
- **Fix:** Remove the field. Otherwise turn it into a used input (for example a target margin the Sandbox and Overview compare actual profit against), or show it read-only as an 'achieved margin' computed from the simulation.
- **Where:** `packages/db/src/model.ts:550 maps margin into EngineService, but no engine code reads it (grep '\.margin\b' packages/engine/src finds nothing outside the implicit retainer)`

## 47. Which deliverables a department has depends on its name starting with 'Perf'  
*low · settings*

- **Now:** Any department not named 'Performance...' gets words, links, tech hours, meetings and ad hoc. A 'Paid Media' or 'Social' department can't enter builds, creative sets or channels.
- **Why it matters:** An agency whose departments aren't literally Organic and Performance can't describe its real work per tier. Renaming 'Performance' to 'Paid' silently switches the columns and hides the stored builds and channels from the editor, though the engine still uses them.
- **Fix:** Add a department 'kind' (or a chosen set of deliverable columns) in Settings > Tiers & clients and drive tierFieldsFor from it instead of the name.
- **Where:** `packages/db/src/capacity-setup.ts:57-59 tierFieldsFor (/^\s*perf/i: Performance fields, otherwise Organic); also apps/web/src/components/setup/tiers-clients.tsx:548 for named clients' Channels`

Status: fixed in this branch

## 48. 'Near threshold' margin of 10 points is fixed, in two separate constants  
*low · pages*

Status: fixed in this branch

- **Now:** Anyone within 10 points under their threshold counts as at risk on Capacity and shows on the Overview's Busiest people; the two copies could drift.
- **Why it matters:** Small agencies running close to the line see half the team permanently 'at risk'; changing one constant would make Overview and Capacity disagree.
- **Fix:** Use one constant (import AT_RISK_MARGIN in busiest-people.tsx); optionally a workspace setting 'Warn when within N points of the threshold' in Settings > People.
- **Where:** `packages/db/src/capacity-figures.ts:775 (AT_RISK_MARGIN = 0.1) and apps/web/src/components/overview/busiest-people.tsx:17 (NEAR_THRESHOLD_MARGIN = 0.1, comment: 'kept apart for now and will be unified'); also apps/web/src/components/people-page.tsx:449 (0.75 amber)`

## 49. DLER, revenue per employee and fee per hour still value counted clients at the service Price, not the group fee the engine uses  
*low · pages*

Status: fixed in this branch

- **Now:** The Overview MRR fix (known issue 2) addresses MRR, but DLER, revenue per employee (wholeBusiness :902) and the Capacity fee-per-hour table use the service price for counted clients while the simulation bills the group fee.
- **Why it matters:** If the group fee differs from the tier price, DLER and revenue-per-employee on Overview/Capacity disagree with the simulated revenue the Sandbox shows.
- **Fix:** Make sure the single-source-of-fee fix for client groups also covers departmentRetainers, personFees and the fee-per-hour table (read the one fee they now share).
- **Where:** `packages/db/src/capacity-figures.ts:392 (departmentRetainers: count x s.price), :417,423,430 (personFees: svc.price), :719 (fee: s.price, feePerHour); packages/db/src/capacity-setup.ts:254 reads client_groups without any fee column`

## 50. Simulation length can't be changed after creating the workspace; Overview caps at 6 months, Capacity fixed at 12  
*low · pages*

Status: fixed in this branch

- **Now:** workspace.settings.horizon_weeks is set only in the new-workspace form; the Overview can only play 1/3/6 months, so its hiring advice never sees a role crossing its line in months 7-12, while Capacity's year run does.
- **Why it matters:** An owner planning a year ahead gets 'no hire needed' on the Overview but a crossing on Capacity, and cannot change the default length they picked at creation.
- **Fix:** Add 'Default forecast length' to Settings > Workspace details (save horizon_weeks), and allow 12 months in OVERVIEW_HORIZONS (or compute hiring advice from the 12-month Capacity year run on the Overview).
- **Where:** `apps/web/src/lib/horizon.ts:23 (OVERVIEW_HORIZONS = [1, 3, 6]) and :27-29 (nearestOverviewHorizon snaps a 12-month workspace to 6); apps/web/src/lib/capacity/model.ts:11 (horizonWeeks(12)); apps/web/src/components/overview/overview.tsx:196,329 (hiring advice from the <=6-month run)`
