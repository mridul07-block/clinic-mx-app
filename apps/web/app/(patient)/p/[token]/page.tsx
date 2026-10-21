// Patient pages at /p/<token>. The token service (IAM-09) verifies the signed,
// single purpose token before any patient data is read; until then nothing is shown.
export default function PatientPage() {
  return (
    <main>
      <h1>Movementology Clinics</h1>
    </main>
  );
}
