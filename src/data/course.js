/**
 * Dummy content for the practice workspace.
 *
 * Shape mirrors what the API is expected to return, so swapping this
 * file for a fetch later should not touch the components:
 *
 *   group    { id, title, blurb, questions[] }
 *   question { id, code, kind, points, prompt, stimulus?, rubric[], tutor }
 *   rubric   { id, label, points, keywords[], coach }
 *   tutor    { opening, hints[], concept, example, misconception }
 *
 * `keywords` exists only to let the placeholder evaluator react to what
 * the student actually typed. The real scoring happens server-side.
 */

export const course = {
  title: 'Cells, Energy & Inheritance',
  subtitle: 'Unit 3 · Biology · Grade 10',
  groups: [
    {
      id: 'transport',
      title: 'Membranes & transport',
      blurb: 'How things cross the membrane, and what it costs.',
      questions: [
        {
          id: 'bio-101',
          code: 'BIO-101',
          kind: 'Explain',
          points: 3,
          prompt:
            'A red blood cell is placed in distilled water. Within a minute it swells and bursts. Explain why, and say why a plant cell in the same beaker would not burst.',
          rubric: [
            {
              id: 'r1',
              label: 'Names the water potential gradient',
              points: 1,
              keywords: ['water potential', 'concentration gradient', 'more dilute', 'hypotonic'],
              coach: 'Say which way water moves and what drives it — compare the water potential inside the cell with the water potential outside.',
            },
            {
              id: 'r2',
              label: 'Identifies osmosis across the membrane',
              points: 1,
              keywords: ['osmosis', 'partially permeable', 'semi-permeable', 'selectively permeable'],
              coach: 'Name the process, and name the property of the membrane that makes it possible.',
            },
            {
              id: 'r3',
              label: 'Credits the cell wall for the plant cell',
              points: 1,
              keywords: ['cell wall', 'cellulose', 'turgid', 'turgor'],
              coach: 'The plant cell has a structure the red blood cell lacks. What does it do once the cell is full?',
            },
          ],
          tutor: {
            opening:
              'This one is really two questions wearing one coat: why the animal cell fails, and why the plant cell holds. Which half feels shakier to you?',
            hints: [
              'Start outside the cell. Distilled water has no solute in it at all. How does its water potential compare with the cytoplasm?',
              'Water moves down that gradient, into the cell, by osmosis. Nothing is pumping it — so what is the membrane doing to allow it?',
              'Now the plant cell. It takes in water the same way and swells the same way, but it stops. A rigid layer outside the membrane pushes back once the cell is full — that pressure is turgor.',
            ],
            concept:
              'Osmosis is the net movement of water across a partially permeable membrane, from higher water potential to lower water potential. Pure water has the highest water potential there is (0 kPa); adding solute lowers it. A red blood cell has only a membrane, so inward water movement stretches it until it lyses. A plant cell has a cellulose wall that resists the stretch — inward pressure builds until it balances the gradient, and the cell sits turgid instead of bursting.',
            example:
              'Worked parallel: a potato cylinder in 1.0 M sucrose. The solution has the lower water potential, so water leaves the cells by osmosis, the vacuoles shrink, and the cylinder loses mass and becomes flaccid. Same principle, opposite direction — that is the answer pattern the examiner wants: state the gradient, name osmosis, then say what the structure does about it.',
            misconception:
              'Careful with "the water is sucked in" or "the cell wants to balance out". Water is not pulled and cells do not want anything — water diffuses down a water potential gradient. Examiners cut marks for that phrasing.',
          },
        },
        {
          id: 'bio-102',
          code: 'BIO-102',
          kind: 'Read the data',
          points: 4,
          prompt:
            'The table shows glucose uptake by intestinal cells at increasing external glucose concentration. Use the data to decide whether uptake here is by diffusion or active transport, and justify your choice with two pieces of evidence.',
          stimulus: {
            kind: 'table',
            caption: 'Glucose uptake, intestinal epithelium, 37 °C',
            columns: ['External glucose / mmol dm⁻³', 'Uptake / µmol g⁻¹ min⁻¹', 'Uptake with cyanide / µmol g⁻¹ min⁻¹'],
            rows: [
              ['1.0', '18', '2'],
              ['2.0', '35', '4'],
              ['4.0', '61', '7'],
              ['8.0', '78', '8'],
              ['16.0', '80', '8'],
            ],
          },
          rubric: [
            {
              id: 'r1',
              label: 'Concludes active transport',
              points: 1,
              keywords: ['active transport', 'active'],
              coach: 'State your conclusion in one sentence before the evidence. Which of the two does the data support?',
            },
            {
              id: 'r2',
              label: 'Uses the plateau as evidence',
              points: 1,
              keywords: ['plateau', 'levels off', 'saturat', 'no longer increase', 'constant at 80'],
              coach: 'Look at the last two rows. Uptake stops rising even though glucose keeps rising. What must be in limited supply?',
            },
            {
              id: 'r3',
              label: 'Uses the cyanide column as evidence',
              points: 1,
              keywords: ['cyanide', 'respiration', 'atp', 'energy'],
              coach: 'Cyanide blocks aerobic respiration. Quote what happens to uptake when it is added, and say what that proves about the energy source.',
            },
            {
              id: 'r4',
              label: 'Quotes figures from the table',
              points: 1,
              keywords: ['80', '78', '61', '8 ', 'µmol', 'umol'],
              coach: 'Add numbers with units. "Uptake falls from 78 to 8 µmol g⁻¹ min⁻¹" earns the mark that "uptake falls" does not.',
            },
          ],
          tutor: {
            opening:
              'Data questions reward quoting, not describing. Before we talk mechanism — what is the single most suspicious number in that third column?',
            hints: [
              'Compare column 2 with column 3 at the same concentration. The difference is enormous, and cyanide only does one thing.',
              'Cyanide inhibits aerobic respiration, so it starves the cell of ATP. If uptake collapses without ATP, uptake must have been spending ATP.',
              'Now the plateau: from 8.0 to 16.0 mmol dm⁻³ uptake barely moves (78 → 80). Diffusion would keep climbing with the gradient. A fixed number of carrier proteins would not — they are all working flat out.',
            ],
            concept:
              'Two fingerprints separate active transport from simple diffusion. First, saturation: active transport runs through a fixed number of carrier proteins, so raising concentration eventually stops helping and the rate plateaus. Second, energy dependence: it hydrolyses ATP, so a respiratory inhibitor such as cyanide collapses the rate. Simple diffusion shows neither — it scales with the gradient and ignores metabolic poisons.',
            example:
              'Model answer opening: "Uptake is by active transport. Rate plateaus at 80 µmol g⁻¹ min⁻¹ between 8.0 and 16.0 mmol dm⁻³, showing carrier proteins are saturated. With cyanide, uptake at 8.0 mmol dm⁻³ falls from 78 to 8 µmol g⁻¹ min⁻¹, showing uptake depends on ATP from aerobic respiration."',
            misconception:
              'A plateau alone is not proof of active transport — facilitated diffusion saturates too, because it also uses a fixed number of channel proteins. The cyanide column is what rules it out. Use both.',
          },
        },
        {
          id: 'bio-103',
          code: 'BIO-103',
          kind: 'Compare',
          points: 3,
          prompt:
            'Give three ways active transport differs from simple diffusion. Write each as a comparison, not as two separate facts.',
          rubric: [
            {
              id: 'r1',
              label: 'Energy: ATP versus none',
              points: 1,
              keywords: ['atp', 'energy', 'passive'],
              coach: 'One process spends metabolic energy and the other does not. Name the molecule.',
            },
            {
              id: 'r2',
              label: 'Direction relative to the gradient',
              points: 1,
              keywords: ['against', 'up the', 'low to high', 'down the', 'high to low'],
              coach: 'Say which way each goes relative to the concentration gradient — one goes against it.',
            },
            {
              id: 'r3',
              label: 'Carrier proteins required or not',
              points: 1,
              keywords: ['carrier protein', 'carrier', 'pump', 'protein'],
              coach: 'One needs a specific protein in the membrane. Name it and say why that makes the process selective.',
            },
          ],
          tutor: {
            opening:
              'Comparison questions have a grammar to them: "whereas" earns marks, a bulleted list of unlinked facts often does not. Want to draft one line and let me mark the phrasing?',
            hints: [
              'Three axes to compare on: energy, direction, and machinery. Pick those and you have your three marks.',
              'Write each as a single sentence containing both halves — "Active transport requires ATP, whereas simple diffusion is passive."',
              'For the third axis, think about what sits in the membrane. Active transport needs a specific carrier protein; simple diffusion goes straight through the phospholipid bilayer.',
            ],
            concept:
              'Simple diffusion is passive: net movement down a concentration gradient, driven by the kinetic energy the particles already have, straight through the bilayer, and it stops at equilibrium. Active transport is the opposite on every axis — it hydrolyses ATP, moves substances against the gradient, and works through specific carrier proteins that change shape as they move their cargo. Because the carriers are specific, active transport is selective in a way diffusion never is.',
            example:
              'Full-mark structure: "Active transport requires ATP, whereas simple diffusion is passive. Active transport moves substances against the concentration gradient, whereas diffusion moves them down it. Active transport needs specific carrier proteins, whereas small non-polar molecules diffuse directly through the phospholipid bilayer."',
            misconception:
              'Do not say diffusion needs "no energy". The particles are moving because they have kinetic energy — what diffusion needs no input of is *metabolic* energy, ATP. Precision matters here.',
          },
        },
      ],
    },
    {
      id: 'enzymes',
      title: 'Enzymes & metabolism',
      blurb: 'Shape is function. Break the shape, break the function.',
      questions: [
        {
          id: 'bio-201',
          code: 'BIO-201',
          kind: 'Explain',
          points: 4,
          prompt:
            'The activity of pepsin peaks at pH 2 and falls almost to zero by pH 7. Explain, in molecular terms, why activity falls on the alkaline side of the optimum.',
          rubric: [
            {
              id: 'r1',
              label: 'Links pH change to bonding in the enzyme',
              points: 1,
              keywords: ['hydrogen bond', 'ionic bond', 'bonds break', 'r-group', 'r group'],
              coach: 'Changing pH changes charges on the amino acid R-groups. Which bonds holding the fold together depend on those charges?',
            },
            {
              id: 'r2',
              label: 'States the tertiary structure changes',
              points: 1,
              keywords: ['tertiary', 'three-dimensional', '3d shape', 'shape change', 'unfold'],
              coach: 'Name the level of protein structure that is lost when those bonds break.',
            },
            {
              id: 'r3',
              label: 'Active site no longer complementary',
              points: 1,
              keywords: ['active site', 'complementary', 'no longer fits', 'substrate cannot'],
              coach: 'Connect the shape change to the one part of the enzyme that has to fit the substrate.',
            },
            {
              id: 'r4',
              label: 'Fewer enzyme–substrate complexes form',
              points: 1,
              keywords: ['enzyme-substrate', 'enzyme–substrate', 'complex', 'fewer complexes'],
              coach: 'Finish the causal chain. If the substrate cannot bind, what stops forming — and that is why the rate drops.',
            },
          ],
          tutor: {
            opening:
              'There are four marks here and they are four links in one chain. Most students win the first and last and skip the middle. Shall we build the chain end to end?',
            hints: [
              'Start with what pH physically is: a concentration of H⁺ ions. Those ions interact with the charged R-groups of the amino acids in the enzyme.',
              'Those charges are what hold ionic and hydrogen bonds together within the folded chain. Change the charges and the bonds break.',
              'Chain it right through: bonds break → tertiary structure changes → active site is no longer complementary to the substrate → fewer enzyme–substrate complexes form → rate falls. Four links, four marks.',
            ],
            concept:
              'An enzyme\'s catalytic power lives in the precise three-dimensional shape of its active site, and that shape is held by hydrogen and ionic bonds between R-groups elsewhere in the chain. Those bonds depend on the ionisation state of the R-groups, which pH controls directly. Move away from the optimum and the bonds break, the tertiary structure distorts, and the active site stops being complementary to the substrate. Fewer enzyme–substrate complexes form each second, so the rate of reaction falls. Push far enough and the change is permanent — the enzyme is denatured.',
            example:
              'Model chain for the acidic side, so you can mirror it: "At pH below the optimum the excess H⁺ ions interfere with ionic bonds between R-groups. These bonds break, changing the tertiary structure of the enzyme. The active site is no longer complementary to the substrate, so fewer enzyme–substrate complexes form and the rate of reaction falls."',
            misconception:
              'Two phrases lose marks every year. Enzymes are not "killed" — they were never alive, they are denatured. And the active site does not "change shape to fit better"; it stops fitting at all.',
          },
        },
        {
          id: 'bio-202',
          code: 'BIO-202',
          kind: 'Predict',
          points: 3,
          prompt:
            'A student boils an amylase solution for five minutes, cools it back to 37 °C, then adds starch. They test for starch with iodine every two minutes for twenty minutes. Predict the results and explain them.',
          rubric: [
            {
              id: 'r1',
              label: 'Predicts starch remains throughout',
              points: 1,
              keywords: ['stays blue-black', 'blue-black', 'blue black', 'starch remains', 'no change', 'still present'],
              coach: 'Say what the iodine test actually shows at every time point, in terms of colour.',
            },
            {
              id: 'r2',
              label: 'Attributes it to denaturation by heat',
              points: 1,
              keywords: ['denatur', 'boiling', 'high temperature', 'bonds break'],
              coach: 'Name what boiling did to the enzyme, and note that cooling does not reverse it.',
            },
            {
              id: 'r3',
              label: 'Explains via the active site',
              points: 1,
              keywords: ['active site', 'complementary', 'cannot bind', 'no longer fits'],
              coach: 'Say why a denatured amylase cannot break down starch — go to the active site.',
            },
          ],
          tutor: {
            opening:
              'Prediction questions want a claim first, then the mechanism. What colour do you think the iodine goes at minute 20 — and does cooling the enzyme back down rescue anything?',
            hints: [
              'Iodine turns blue-black when starch is present and stays orange-brown when it is not. So the prediction is a colour, at every time point.',
              'Boiling breaks the hydrogen and ionic bonds holding amylase\'s tertiary structure. That change is permanent — cooling to 37 °C does not refold the enzyme.',
              'So the active site is no longer complementary to starch, no enzyme–substrate complexes form, no maltose is produced, and every iodine test from 0 to 20 minutes is blue-black.',
            ],
            concept:
              'Denaturation is not the same as slowing down. Below the optimum, low temperature reduces kinetic energy — fewer successful collisions, slower rate, but the enzyme is intact and warming it up restores activity. Above the optimum, heat breaks the bonds holding the tertiary structure, and that loss is irreversible. The distinction is exactly what this question tests: the student cooled the solution back to 37 °C, which would restore a cold enzyme but does nothing for a boiled one.',
            example:
              'Model answer: "The iodine will turn blue-black at every time point, showing starch is still present. Boiling denatured the amylase by breaking the bonds that maintain its tertiary structure. This is irreversible, so cooling to 37 °C does not restore the active site. The active site is no longer complementary to starch, so no enzyme–substrate complexes form and no starch is digested."',
            misconception:
              'The trap is writing "the enzyme works again once it cools to its optimum". That is true for a chilled enzyme, never for a boiled one. The word to reach for is irreversible.',
          },
        },
        {
          id: 'bio-203',
          code: 'BIO-203',
          kind: 'Compare',
          points: 4,
          prompt:
            'Explain how competitive and non-competitive inhibitors reduce the rate of an enzyme-controlled reaction, and explain why increasing substrate concentration overcomes only one of them.',
          rubric: [
            {
              id: 'r1',
              label: 'Competitive: binds the active site',
              points: 1,
              keywords: ['active site', 'similar shape', 'complementary to the active site'],
              coach: 'Say where a competitive inhibitor binds and why it is able to — think about its shape.',
            },
            {
              id: 'r2',
              label: 'Non-competitive: binds elsewhere, alters the site',
              points: 1,
              keywords: ['allosteric', 'elsewhere', 'away from', 'different site', 'changes the shape'],
              coach: 'A non-competitive inhibitor never touches the active site. Say where it binds and what that does to the site.',
            },
            {
              id: 'r3',
              label: 'Explains the competition for the site',
              points: 1,
              keywords: ['compete', 'competition', 'blocks', 'prevents the substrate'],
              coach: 'For the competitive case, explain what the inhibitor and substrate are competing for.',
            },
            {
              id: 'r4',
              label: 'Excess substrate outcompetes only the competitive one',
              points: 1,
              keywords: ['increasing substrate', 'excess substrate', 'more substrate', 'outcompete', 'reverse'],
              coach: 'Explain what raising substrate concentration does to the odds at the active site — and why that logic fails for the non-competitive inhibitor.',
            },
          ],
          tutor: {
            opening:
              'The name gives away half the answer: competitive inhibitors compete *for something specific*. Can you say what, in three words?',
            hints: [
              'A competitive inhibitor has a shape complementary to the active site, so it occupies the site the substrate needs.',
              'A non-competitive inhibitor binds at a different site altogether and distorts the enzyme, so the active site stops being complementary to the substrate.',
              'Now the last mark. Competitive inhibition is a numbers game at one location — flood the system with substrate and substrate wins more collisions, so the rate recovers. Non-competitive inhibition changed the site itself, so extra substrate has nothing better to bind to and the rate stays low.',
            ],
            concept:
              'Competitive inhibitors are structural mimics of the substrate: they are complementary to the active site, bind there, and block it. Because inhibitor and substrate compete for the same site, the outcome depends on their relative concentrations — raising substrate concentration raises the proportion of collisions that are productive, and the rate climbs back toward normal. Non-competitive inhibitors bind at a separate (allosteric) site and change the enzyme\'s tertiary structure, so the active site is no longer complementary. No amount of substrate fixes a site that no longer fits.',
            example:
              'Real pair to anchor it: malonate competitively inhibits succinate dehydrogenase because it resembles succinate closely enough to sit in the active site. Cyanide non-competitively inhibits cytochrome c oxidase — it binds away from the active site and distorts the enzyme. Adding more succinate rescues the first; adding more substrate does nothing for the second.',
            misconception:
              'Non-competitive does not mean "irreversible", and it does not mean the inhibitor is permanently stuck. It only means the inhibitor is not competing for the active site.',
          },
        },
      ],
    },
    {
      id: 'energy',
      title: 'Photosynthesis & respiration',
      blurb: 'Follow the carbon, follow the electrons.',
      questions: [
        {
          id: 'bio-301',
          code: 'BIO-301',
          kind: 'Structure & function',
          points: 2,
          prompt:
            'The inner membrane of a mitochondrion is folded into cristae. Explain how this folding increases the rate of ATP production.',
          rubric: [
            {
              id: 'r1',
              label: 'Folding increases surface area',
              points: 1,
              keywords: ['surface area', 'larger area', 'more area'],
              coach: 'Start with the geometry: what does folding a membrane do to the area available?',
            },
            {
              id: 'r2',
              label: 'More space for electron transport chains and ATP synthase',
              points: 1,
              keywords: ['electron transport', 'atp synthase', 'carrier', 'more enzymes', 'more proteins'],
              coach: 'Say which molecules that extra area holds — naming them is what turns a geometry point into a biology mark.',
            },
          ],
          tutor: {
            opening:
              'Two marks, so two ideas, and the second is the one people leave out. You probably have the surface area point already — what actually sits *on* that surface?',
            hints: [
              'Folding a membrane into cristae increases the surface area inside a fixed volume.',
              'That membrane is not passive real estate. Name what is embedded in it: electron transport chain proteins and ATP synthase.',
              'More area means more of those complexes per mitochondrion, so more oxidative phosphorylation can run at once — more ATP per second.',
            ],
            concept:
              'Surface-area answers are only worth marks when you say what the surface is for. The inner mitochondrial membrane carries the electron transport chain and ATP synthase; cristae pack more of that membrane into the same organelle volume, so more of these complexes operate in parallel and the rate of oxidative phosphorylation rises. It is the same logic as villi in the ileum or thylakoid stacking in a chloroplast — folding buys machinery, not just area.',
            example:
              'Predictable follow-up worth preparing: "Muscle cells contain mitochondria with more densely packed cristae than skin cells. Suggest why." Answer with the same two links — greater surface area for electron transport chains and ATP synthase, so a higher rate of ATP production for contraction.',
            misconception:
              '"Bigger surface area so more reactions happen" is a half-answer and scores one of two. Name the proteins.',
          },
        },
        {
          id: 'bio-302',
          code: 'BIO-302',
          kind: 'Trace',
          points: 5,
          prompt:
            'Trace a single carbon atom from a CO₂ molecule in the air to a carbon atom in a molecule of lactate in a sprinter\'s muscle. Name the stages and the key molecules it becomes along the way.',
          rubric: [
            {
              id: 'r1',
              label: 'Fixed by rubisco into GP in the Calvin cycle',
              points: 1,
              keywords: ['rubisco', 'calvin', 'ribulose bisphosphate', 'rubp', 'glycerate'],
              coach: 'Name the enzyme that fixes CO₂ and the acceptor molecule it joins.',
            },
            {
              id: 'r2',
              label: 'Reduced to triose phosphate, built into glucose',
              points: 1,
              keywords: ['triose phosphate', 'tp', 'glucose', 'starch'],
              coach: 'What does GP become when it is reduced, and what is built from it for storage?',
            },
            {
              id: 'r3',
              label: 'Glycolysis in the cytoplasm',
              points: 1,
              keywords: ['glycolysis', 'cytoplasm', 'cytosol'],
              coach: 'Name the first stage of respiration and where in the cell it happens.',
            },
            {
              id: 'r4',
              label: 'Glucose to pyruvate',
              points: 1,
              keywords: ['pyruvate', 'pyruvic'],
              coach: 'Name the three-carbon product at the end of glycolysis.',
            },
            {
              id: 'r5',
              label: 'Pyruvate reduced to lactate by NADH under anaerobic conditions',
              points: 1,
              keywords: ['lactate', 'reduced', 'nadh', 'nad', 'anaerobic'],
              coach: 'Say what reduces pyruvate to lactate, and why the sprinter\'s muscle does this instead of using the Krebs cycle.',
            },
          ],
          tutor: {
            opening:
              'Five marks means five checkpoints — this is a route, not an essay. Want to list the checkpoints first and fill in the mechanism after?',
            hints: [
              'The route has two halves: the carbon is captured by a plant, then eaten and respired. Start with capture — which cycle, which enzyme?',
              'Checkpoints one to three: CO₂ + ribulose bisphosphate → glycerate 3-phosphate (rubisco, Calvin cycle) → reduced to triose phosphate → built into glucose.',
              'Second half: glucose is eaten and enters glycolysis in the cytoplasm, becoming pyruvate. With no oxygen reaching the sprinter\'s muscle fast enough, pyruvate is reduced to lactate by NADH — which regenerates the NAD that glycolysis needs to keep running.',
            ],
            concept:
              'Trace questions are marked on named checkpoints, not prose quality. The full route: CO₂ diffuses through a stoma into the stroma, where rubisco joins it to ribulose bisphosphate to make two molecules of glycerate 3-phosphate. GP is reduced to triose phosphate using ATP and reduced NADP from the light-dependent stage, and TP is used to build glucose. Eaten, that glucose enters glycolysis in the cytoplasm and is converted to pyruvate. When oxygen supply cannot keep up with demand, pyruvate accepts hydrogen from reduced NAD and becomes lactate — the point of which is regenerating NAD so glycolysis, and therefore ATP production, can continue.',
            example:
              'Checkpoint list to memorise, in order: CO₂ → GP → TP → glucose → pyruvate → lactate. Attach a location or an enzyme to each arrow and you have five marks: rubisco/stroma, reduction by NADP, glycolysis/cytoplasm, and reduction by NADH.',
            misconception:
              'Lactate fermentation is not there to make energy — it yields no extra ATP. Its whole purpose is to oxidise NADH back to NAD so glycolysis can keep going. Saying "lactate is produced to release more energy" loses the mark.',
          },
        },
        {
          id: 'bio-303',
          code: 'BIO-303',
          kind: 'Read the data',
          points: 4,
          prompt:
            'An oxygen probe sits in a sealed tube of pondweed. The lamp is off for the first hour and on for the second. Use the readings to explain what the plant is doing in each hour, and explain why the hour-two figure is not the rate of photosynthesis.',
          stimulus: {
            kind: 'table',
            caption: 'Dissolved O₂ in a sealed tube of Elodea, 20 °C',
            columns: ['Time / min', 'Lamp', 'Dissolved O₂ / mg dm⁻³'],
            rows: [
              ['0', 'off', '8.4'],
              ['30', 'off', '7.1'],
              ['60', 'off', '5.9'],
              ['90', 'on', '9.6'],
              ['120', 'on', '13.2'],
            ],
          },
          rubric: [
            {
              id: 'r1',
              label: 'Hour 1: respiration only, O₂ consumed',
              points: 1,
              keywords: ['respiration', 'respiring', 'uses oxygen', 'consumed'],
              coach: 'In the dark only one of the two processes can run. Name it and say what it does to dissolved O₂.',
            },
            {
              id: 'r2',
              label: 'Hour 2: photosynthesis exceeds respiration',
              points: 1,
              keywords: ['photosynthesis', 'exceeds', 'faster than', 'greater than'],
              coach: 'O₂ rises in hour two. That does not mean respiration stopped — compare the two rates.',
            },
            {
              id: 'r3',
              label: 'Identifies the figure as net, not gross',
              points: 1,
              keywords: ['net', 'gross', 'apparent', 'true rate'],
              coach: 'There is a specific term for a rate measured while respiration is also consuming the product. Use it.',
            },
            {
              id: 'r4',
              label: 'States gross = net + respiration',
              points: 1,
              keywords: ['add', 'plus', 'sum', 'net + respiration', 'gross =', 'correct for respiration'],
              coach: 'Say how you would get the true rate from these numbers — the dark hour gives you the correction.',
            },
          ],
          tutor: {
            opening:
              'The sting is in the last part. Between minute 60 and 120 the probe gains 7.3 mg dm⁻³ — but the plant made more O₂ than that. Any idea where the rest went?',
            hints: [
              'Hour one, lamp off: no photosynthesis is possible, so the fall from 8.4 to 5.9 mg dm⁻³ is respiration consuming O₂.',
              'Hour two, lamp on: respiration has not paused — it never does. O₂ rises only because photosynthesis is now producing faster than respiration consumes.',
              'So the probe reads *net* photosynthesis. The dark hour gives you the respiration rate (2.5 mg dm⁻³ per hour), so gross photosynthesis = net + respiration ≈ 7.3 + 2.5 mg dm⁻³ per hour.',
            ],
            concept:
              'Any probe in a sealed tube measures the balance of two opposing processes. Respiration runs continuously in light and dark; photosynthesis runs only in light. So a rising O₂ reading is net photosynthesis — gross production minus respiratory consumption. The standard experimental fix is exactly what this setup provides: measure O₂ change in the dark to get the respiration rate, then add it to the light-period change to recover gross photosynthesis.',
            example:
              'Numbers worked through: dark hour, 8.4 → 5.9 = 2.5 mg dm⁻³ h⁻¹ of respiration. Light hour, 5.9 → 13.2 = +7.3 mg dm⁻³ h⁻¹ net. Gross photosynthesis ≈ 9.8 mg dm⁻³ h⁻¹, assuming the respiration rate is unchanged in the light — which is worth stating as an assumption.',
            misconception:
              'The commonest error is "the plant stops respiring in the light" or "photosynthesis replaces respiration". Both processes run at once; light only adds the second one.',
          },
        },
      ],
    },
    {
      id: 'inheritance',
      title: 'Inheritance',
      blurb: 'Crosses, probability, and why selection keeps a harmful allele.',
      questions: [
        {
          id: 'bio-401',
          code: 'BIO-401',
          kind: 'Genetics',
          points: 4,
          prompt:
            'Two brown-eyed parents have a blue-eyed child. Brown (B) is dominant to blue (b). Explain how this is possible, show the cross, and state the probability that their next child has blue eyes.',
          rubric: [
            {
              id: 'r1',
              label: 'Both parents heterozygous Bb',
              points: 1,
              keywords: ['bb x bb', 'heterozygous', 'both bb', 'carriers'],
              coach: 'Give both parental genotypes. Brown-eyed leaves two options each — which pair must it be?',
            },
            {
              id: 'r2',
              label: 'Child is homozygous recessive bb',
              points: 1,
              keywords: ['homozygous recessive', 'bb', 'two recessive'],
              coach: 'State the child\'s genotype and why blue eyes require exactly that.',
            },
            {
              id: 'r3',
              label: 'Shows gametes and the cross',
              points: 1,
              keywords: ['gamete', 'punnett', 'cross', 'b and b'],
              coach: 'Show your working — parental genotypes, the gametes each can make, then the offspring combinations.',
            },
            {
              id: 'r4',
              label: 'States 25% / 1 in 4',
              points: 1,
              keywords: ['25', '1 in 4', '1/4', 'quarter', '0.25'],
              coach: 'Give the probability for the next child as a number, and remember each pregnancy is independent.',
            },
          ],
          tutor: {
            opening:
              'Both parents show the dominant phenotype, yet the child shows the recessive one — so each parent must be hiding something. What genotype lets a brown-eyed parent pass on blue?',
            hints: [
              'Blue eyes are recessive, so the child must be bb — one b from each parent. That already tells you both parents carry b.',
              'Each parent has brown eyes, so each has at least one B. With a b as well, both parents must be Bb.',
              'Bb × Bb gives gametes B and b from each side: BB, Bb, Bb, bb. One in four is bb, so the probability is 25% for each subsequent child independently.',
            ],
            concept:
              'A recessive phenotype appearing from two dominant-phenotype parents is the classic signature of both parents being heterozygous. Work it backwards from the child every time: the child\'s phenotype fixes their genotype (bb), which fixes what each parent must have contributed (one b each), which combined with each parent\'s own phenotype (at least one B) fixes both parents as Bb. The 3:1 ratio from Bb × Bb is a probability per offspring, not a quota — three brown-eyed children already born do not make the fourth blue-eyed.',
            example:
              'Set the cross out like this, and show the gamete row — it carries its own mark:\n\n  Parents   Bb  ×  Bb\n  Gametes  (B)(b)  (B)(b)\n\n            |  B  |  b\n        ----+-----+-----\n         B  | BB  | Bb\n         b  | Bb  | bb\n\n  Offspring 1 BB : 2 Bb : 1 bb → 3 brown : 1 blue → P(blue) = 25%',
            misconception:
              'Watch the phrasing "the child inherited the blue gene from one parent". Blue eyes need two recessive alleles, one from each parent — and allele is the word, not gene.',
          },
        },
        {
          id: 'bio-402',
          code: 'BIO-402',
          kind: 'Explain',
          points: 3,
          prompt:
            'Red-green colour blindness is caused by a recessive allele on the X chromosome. Explain why it is far more common in males than in females.',
          rubric: [
            {
              id: 'r1',
              label: 'Males are XY, one copy of the gene',
              points: 1,
              keywords: ['xy', 'one x', 'single x', 'only one copy'],
              coach: 'Give the male sex chromosomes and say how many copies of an X-linked gene that gives.',
            },
            {
              id: 'r2',
              label: 'Y carries no equivalent allele to mask it',
              points: 1,
              keywords: ['y chromosome', 'no allele', 'cannot mask', 'no dominant allele', 'shorter'],
              coach: 'Explain why the second sex chromosome cannot rescue a male — what is missing from the Y?',
            },
            {
              id: 'r3',
              label: 'Females need two recessive alleles',
              points: 1,
              keywords: ['two recessive', 'xx', 'both x', 'homozygous recessive', 'carrier'],
              coach: 'State what a female needs in order to be affected, and what she is if she has just one copy.',
            },
          ],
          tutor: {
            opening:
              'The whole answer turns on a counting difference. How many copies of an X-linked gene does a male have, and how many does a female have?',
            hints: [
              'Males are XY. The colour vision gene is on the X, so a male has exactly one copy of it.',
              'The Y chromosome is much shorter and carries no equivalent allele, so there is no dominant allele available to mask a recessive one. A single recessive allele is expressed.',
              'Females are XX, so they carry two copies. One recessive allele is masked by a dominant one on the other X — she is a carrier with normal vision. Being affected needs both, which is much rarer.',
            ],
            concept:
              'For X-linked recessive conditions the male genotype has no spare copy. Males are described as hemizygous: one X, one allele, expressed whatever it is. The Y is small and lacks the corresponding locus, so it cannot supply a masking dominant allele. Females need the recessive allele on both X chromosomes to be affected, and the probability of inheriting two recessive alleles is far lower than inheriting one — which is exactly why the condition is more common in males.',
            example:
              'Worth checking you can also do the cross: a carrier mother XᴮXᵇ with an unaffected father XᴮY gives XᴮXᴮ, XᴮXᵇ, XᴮY, XᵇY. No affected daughters, half the sons affected. Always write X-linked genotypes with the allele as a superscript on the X — bare "Bb" loses marks in these questions.',
            misconception:
              'Colour blindness is not "carried on the Y" and it is not passed father to son. An affected father gives his X to every daughter and his Y to every son.',
          },
        },
        {
          id: 'bio-403',
          code: 'BIO-403',
          kind: 'Evaluate',
          points: 5,
          prompt:
            'The sickle-cell allele is harmful in the homozygous state, yet it stays common in parts of Africa where malaria is endemic. Explain this, using the data, and evaluate how far the data support your explanation.',
          stimulus: {
            kind: 'table',
            caption: 'Sickle-cell allele frequency and malaria incidence, four regions',
            columns: ['Region', 'Malaria cases / 1000 per year', 'HbS allele frequency / %'],
            rows: [
              ['Coastal West Africa', '410', '14.2'],
              ['Central lowlands', '355', '12.6'],
              ['Highlands, >1800 m', '46', '3.1'],
              ['North, arid zone', '11', '1.4'],
            ],
          },
          rubric: [
            {
              id: 'r1',
              label: 'Heterozygotes have increased resistance to malaria',
              points: 1,
              keywords: ['heterozygous', 'heterozygote', 'carrier', 'resistance', 'resistant'],
              coach: 'Name which genotype has the advantage and what the advantage is against.',
            },
            {
              id: 'r2',
              label: 'Heterozygote advantage: higher survival and reproduction',
              points: 1,
              keywords: ['survive', 'survival', 'reproduce', 'pass on', 'selective advantage', 'fitness'],
              coach: 'Link resistance to the mechanism of selection — surviving is only half of it.',
            },
            {
              id: 'r3',
              label: 'Balanced selection maintains the allele frequency',
              points: 1,
              keywords: ['balanc', 'both directions', 'selected against', 'equilibrium', 'maintained'],
              coach: 'Selection acts on the homozygotes too. Describe both pressures and why the result is a stable middling frequency.',
            },
            {
              id: 'r4',
              label: 'Uses the data: frequency tracks malaria incidence',
              points: 1,
              keywords: ['14.2', '1.4', '3.1', 'highland', 'correlat', 'as malaria'],
              coach: 'Quote figures from two contrasting regions to show the pattern.',
            },
            {
              id: 'r5',
              label: 'Evaluates: correlation is not causation, limitations',
              points: 1,
              keywords: ['correlation', 'does not prove', 'cause', 'other factor', 'migration', 'only four', 'sample'],
              coach: 'This is an evaluate question — say what the data cannot show, and name one other factor that could produce the same pattern.',
            },
          ],
          tutor: {
            opening:
              'Five marks and the last one is the one most students drop: "evaluate" means you must turn on your own explanation and say where the data are weak. Want to do the biology first, then the critique?',
            hints: [
              'Three genotypes, three outcomes. HbA HbA is vulnerable to malaria; HbS HbS has sickle-cell anaemia; HbA HbS has mild or no anaemia and increased resistance to malaria.',
              'So where malaria is common, heterozygotes are the most likely to survive to reproductive age and pass on both alleles. Selection against both homozygotes holds the allele at an intermediate frequency rather than eliminating it — that is balanced selection.',
              'Now the data and the critique. Frequency falls from 14.2% at 410 cases per 1000 to 1.4% at 11 cases per 1000 — a clear correlation with malaria incidence. But four regions is a small sample, correlation does not establish causation, and altitude differs alongside malaria, so factors such as migration, ancestry or healthcare access could contribute.',
            ],
            concept:
              'Balanced selection keeps a harmful allele in a population when the heterozygote is fitter than either homozygote. For sickle cell, HbA HbA individuals are susceptible to falciparum malaria, HbS HbS individuals suffer sickle-cell anaemia, and HbA HbS individuals get substantial malaria resistance at low cost. Where malaria is endemic, selection therefore pushes from both ends and the allele settles at an intermediate equilibrium frequency. Remove the malaria and the advantage disappears — which is why frequency is low in the highlands and the arid north, and why it declines over generations in populations that migrate away from malarial regions.',
            example:
              'Structure for an evaluate answer: (1) the mechanism, (2) the data that fit it with quoted figures, (3) two specific limitations, (4) one line on what evidence would settle it. Here, (4) could be genotype-level survival data within a single region — that would test the mechanism directly instead of relying on a between-region correlation.',
            misconception:
              'The allele is not "kept because the population needs it", and it does not appear in response to malaria. Mutation is random; malaria only changes which existing genotypes survive to reproduce. Teleological phrasing loses marks even when the biology behind it is right.',
          },
        },
      ],
    },
  ],
}

/** Flat list, in sidebar order, with the group stitched onto each question. */
export const questions = course.groups.flatMap((group) =>
  group.questions.map((question) => ({
    ...question,
    groupId: group.id,
    groupTitle: group.title,
  })),
)

/** Pre-seeded so the demo does not open on an empty set. */
export const seedState = {
  'bio-101': {
    status: 'mastered',
    draft:
      'Distilled water has a higher water potential than the cytoplasm of the red blood cell, so water moves into the cell by osmosis through the partially permeable membrane. The cell has no cell wall, so it keeps swelling until the membrane bursts. A plant cell takes in water the same way, but its cellulose cell wall resists the pressure, so the cell becomes turgid instead of bursting.',
  },
  'bio-102': {
    status: 'revise',
    draft:
      'It is active transport because the graph levels off at the end and adding cyanide makes uptake much smaller.',
  },
  'bio-201': { status: 'draft', draft: 'Higher pH changes the shape of the enzyme so it stops working as well.' },
}

/** Replies for free-text messages, so the composer feels alive without an API. */
export const fallbackReplies = [
  'Good — say more about the second half of that. Which molecule are you picturing when you say it?',
  'That is the right instinct, but an examiner would want the causal step in between. What links those two ideas?',
  'Close. One term in there is doing the wrong job — read it back and tell me which one you would swap.',
  'Yes. Now write it as one sentence in your answer box and I will mark the phrasing.',
  'Let us test that. If it were true, what would you expect the data to look like instead?',
]
