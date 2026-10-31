# Knowledge base clean up: for the clinic to confirm (SET-12, OPS-02)

Velyx Labs drafted these changes on 31 October 2026 so the build is not held up. Clinical
decisions are the clinic's: each item below is a draft to confirm or correct.

- **What is kept:** no workbook text was changed. The workbooks are imported word for word.
- **How the draft reaches clinicians:** the changes are a new knowledge base version, recorded as a
  draft. Nothing reaches clinicians until the Super Admin approves that version on the Knowledge
  base page, after reading its import report.
- **Sending corrections:** mark them on this page or in the workbooks and send them back. We import
  them as the next version.

## 1. Diagnosis categories (SET-12)

The clinic's 44 "Physiotherapeutic diagnosis" categories are now mapped to the knowledge base
conditions: **245 of 332 conditions have a suggested category**. The import report lists every
category with its conditions, and the conditions with none ("Diagnosis categories" in
`docs/knowledge-base/import-report.md`, also on the version's page).

How the draft was made:

- **The region's own category first.** For example, "Knee - Meniscus Rehabilitation" for the
  meniscal tears, "Foot & Ankle - Tendon pathologies" for the Achilles and peroneal tendons, and
  "Knee- Others" for a knee condition no other knee category fits.
- **The "Sports Injuries" categories** where the region has no fitting category. For example,
  muscle strains at the elbow, hip and shoulder; ligament sprains at the elbow, shoulder and thumb;
  cartilage lesions at the elbow.
- **Nerve entrapments and nerve injuries** go to "Neurological impairments" (carpal tunnel, cubital
  tunnel, tarsal tunnel, meralgia). Morton's neuroma stays a foot pathology.
- **"Non specific pain"** for non-specific neck pain and non-specific low back pain. **"Chronic
  pain"** for pain with central sensitisation, persistent spinal pain syndrome and CRPS.
- **No category suggested (87 conditions):**
  - Emergencies and serious medical conditions: infection, malignancy, compartment syndrome,
    cauda equina, vascular, cervical fracture and instability with rheumatoid or Down syndrome.
    Other conditions the workbooks give a red flag tier, such as lumbar radiculopathy or Achilles
    rupture, are mapped; their red flag screening is unchanged.
  - Fractures, and bone stress injuries at the hip, pelvis, femur, rib and ulna. Those at the
    foot, ankle, tibia, patella and lumbar pars are mapped to their region.
  - Paediatric hip conditions (Perthes, slipped epiphysis, transient synovitis) and growth plate
    injuries at the shoulder, elbow and wrist (Little League shoulder and elbow, Panner disease,
    gymnast's wrist). Osgood-Schlatter, Sever's disease, adolescent OCD and Scheuermann disease are
    mapped to their region.
  - Inflammatory and systemic arthritis.
  - Osteoarthritis of a joint with no degenerative category (hip, shoulder, elbow, thumb).
  - Others no category names, for example migraine and tension-type headache, pubic and inguinal
    groin pain, olecranon bursitis, posteromedial elbow impingement, ulnar impaction and Kienbock
    disease. The import report lists all 87.
- **Post operative categories are not suggested.** The exception is post-meniscectomy overload and
  hip post-arthroplasty complications. Whether a patient had surgery is not in the condition.

**In the consultation**, the category is now a suggestion the clinician can change (for example
to a post operative category after surgery), and what they choose is what the signed diagnosis
keeps. Choosing another condition keeps a category the clinician picked.

**To confirm:**

- Are the regional choices right?
- Should non-specific neck and back pain be "Non specific pain", or "Spine - neck - Lower cervical
  Dysfunction" and "Spine - Lower back dysfunction"?
- Do you want "Neurological impairments" for peripheral nerve entrapments?

## 2. Duplicate rows merged (OPS-02)

The same condition in two workbooks now shares one condition ID. Each workbook's text is kept
under it, so nothing is lost. The 9 named alike were already merged. These were merged now,
keeping the older ID: 11 new merges, and HIP-035, which already joined two workbooks and gains
the lumbar row:

| Condition ID | Rows now under it |
| --- | --- |
| HIP-022 | Femoral Neck Stress Fracture - Tension Side (Hip); Femoral neck — tension side (Bone Stress) |
| HIP-023 | Femoral Neck Stress Fracture - Compression Side (Hip); Femoral neck — compression side (Bone Stress) |
| HIP-024 | Pubic Ramus Stress Fracture (Hip); Pubic ramus / inferior pubic ramus (Bone Stress) |
| HIP-025 | Sacral Stress Fracture (Hip); Sacral Stress / Insufficiency Fracture (Lumbar); Sacrum / sacral ala (Bone Stress) |
| HIP-035 | Axial Spondyloarthritis (Hip; Cervical); Inflammatory Sacroiliitis / Axial Spondyloarthritis (Lumbar) |
| LUM-015 | Spondylolysis (Lumbar); Lumbar pars interarticularis (Bone Stress) |
| ANK-011 | Medial Malleolar Stress Fracture (Foot and ankle); Medial malleolus (Bone Stress) |
| ANK-012 | Navicular Stress Fracture (Foot and ankle); Tarsal navicular (Bone Stress) |
| ANK-015 | Talar Dome Osteochondral Lesion (Foot and ankle); Osteochondral lesion of the talus (Bone Stress) |
| ANK-024 | Calcaneal Stress Fracture (Foot and ankle); Calcaneus (Bone Stress) |
| ANK-029 | Metatarsal Stress Fracture (2nd-4th) (Foot and ankle); Metatarsal shaft 2-4 (Bone Stress) |
| KNE-035 | Bucket Handle Meniscus Tear (Knee); Bucket-handle displaced tear (Bone Stress) |

These IDs are no longer used: BSC-001, BSC-002, BSC-004, BSC-005, BSC-006, BSC-010, BSC-012,
BSC-013, BSC-014, BSC-030, BSC-032, LUM-020 and LUM-025. A record made with an earlier version
keeps that version, so nothing already written changes.

**Not merged** (they look alike but differ in site, cause or patient group):

- septic arthritis of different joints;
- HIP-021, ANK-040 and LUM-008 (lumbar radiculopathy described from three regions);
- LUM-026 (pelvic insufficiency fracture) and HIP-024 (pubic ramus stress fracture);
- KNE-024 (osteochondritis dissecans) and BSC-026 and BSC-027 (juvenile and adult forms);
- KNE-036 (chondral lesion) and the graded chondral lesions BSC-021 to BSC-028;
- ANK-006 (fifth metatarsal base fracture) and BSC-016 (Jones zone 2).

**To confirm:**

- Are these merges right?
- Should any of the rows not merged be merged?
- Should KNE-013 Hamstring Tendinopathy and KNE-030 Biceps Femoris Tendinopathy be merged? Biceps
  femoris is a hamstring, and the two rows share their Management Emphasis.

## 3. Copied text (OPS-02)

The import finds text of 80 characters or more that is identical under different conditions. After
the merges, 21 such places remain. Most look rightly shared, and no workbook text was changed.

**Looks rightly shared** (the same condition seen from another region, or advice that applies to
the whole group):

- cervical radiculopathy (Shoulder, Elbow, Forearm and wrist);
- flexor-pronator strain (Elbow, Forearm and wrist);
- compartment syndrome (forearm and leg);
- septic arthritis (shoulder, elbow);
- inflammatory arthritis (elbow, wrist, hip, knee);
- facet joint pain and facet arthropathy (cervical);
- lumbar radiculopathy (Hip, Foot and ankle);
- pubic ramus and sacral stress fractures (Loading Stage);
- end-stage shoulder and hip osteoarthritis (Referral / Surgical Trigger).

**Worth a clinician's look:**

- **ELB-005 Radial Tunnel and ELB-034 Pronator Syndrome:** identical Manual Therapy, Bracing &
  Adjuncts. These are two different nerves. Does the splinting advice fit both?
- **ELB-036 Traumatic Peripheral Nerve Injury and WRI-025 Anterior Interosseous Nerve Syndrome:**
  identical Loading Stage & Entry Dose. One is traumatic and one is usually not.
- **KNE-013 Hamstring Tendinopathy and KNE-030 Biceps Femoris Tendinopathy:** identical Management
  Emphasis (see section 2).

The full list, with where each text appears, is under "Copied text" in the import report.

## 4. Thoracic spine (OPS-02)

**No thoracic spine workbook exists, so thoracic conditions are missing.**

- **Where this shows:**
  - The import report's Gaps section, and the version's page.
  - "Spine - Thoracic dysfunction" has only Scheuermann disease mapped to it (from the Lumbar
    workbook).
  - When the health form marks upper back pain, the diagnosis shortlist says there is no
    thoracic workbook.
- **What the clinic sends:** a tenth workbook in the same format as the other nine (Master Matrix,
  Progress Tracker, Special Tests, Phased Programme). We import it as the next version.
- **Until then:** clinicians choose the closest condition, or record the diagnosis in the movement
  diagnosis line.
