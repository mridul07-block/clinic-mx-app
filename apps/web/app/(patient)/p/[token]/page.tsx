// Patient pages at /p/<token>. The token service (IAM-09) verifies the signed,
// single purpose token before any patient data is read; until then nothing is shown.
// data-voice="patient" sets the patient base size, 16 px (Frontend Specification section 1).
export default function PatientPage() {
  return (
    <main data-voice="patient" className="min-h-dvh bg-surface px-4 py-6">
      <h1 className="text-xl font-semibold">Movementology Clinics</h1>
    </main>
  );
}
