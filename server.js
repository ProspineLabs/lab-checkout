function generatePDF(name, dob, gender, tests) {
  return new Promise((resolve) => {

    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];

    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    /* ===== LOGO (CENTERED + SAFE) ===== */
    const logoWidth = 200;
    const logoHeight = 80;
    const centerX = (doc.page.width - logoWidth) / 2;

    if (fs.existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, centerX, 30, { width: logoWidth });
    }

    /* 🔥 CRITICAL FIX — FORCE CONTENT BELOW LOGO */
    doc.y = 30 + logoHeight + 30;

    /* ===== TITLE ===== */
    doc.fontSize(18)
      .fillColor("#2c7be5")
      .text("LAB ORDER SUMMARY", { align: "center" });

    doc.moveDown(2);

    /* ===== PATIENT BOX ===== */
    let yStart = doc.y;
    drawBox(doc, yStart - 5, 100);

    doc.fontSize(13).fillColor("black")
      .text("Patient Information", 60, yStart);

    doc.moveDown(1);

    doc.fontSize(11)
      .text(`Name: ${name}`)
      .text(`DOB: ${dob}`)
      .text(`Gender: ${gender}`);

    doc.moveDown(3);

    /* ===== TEST BOX ===== */
    yStart = doc.y;

    const testBoxHeight = tests.length * 30 + 60;
    drawBox(doc, yStart - 5, testBoxHeight);

    doc.fontSize(13)
      .text("Ordered Tests", 60, yStart);

    doc.moveDown(1);

    tests.forEach(t => {
      doc.fontSize(11)
        .text(`• ${t.name} (Code: ${t.code})`);

      if (TEST_INSTRUCTIONS[t.code]) {
        doc.fillColor("#2c7be5")
          .text(`   ${TEST_INSTRUCTIONS[t.code]}`);
        doc.fillColor("black");
      }

      doc.moveDown(1);
    });

    doc.moveDown(3);

    /* ===== PROVIDER BOX ===== */
    yStart = doc.y;
    drawBox(doc, yStart - 5, 110);

    doc.fontSize(13)
      .text("Ordering Provider", 60, yStart);

    doc.moveDown(1);

    doc.fontSize(11)
      .text("Dr. Cleberton S. Bastos, DC")
      .text("NPI: 1013268028")
      .text("ProSpine Orlando Chiropractic")
      .text("Quest Account: 11845569");

    doc.moveDown(3);

    /* ===== INSTRUCTIONS BOX ===== */
    yStart = doc.y;
    drawBox(doc, yStart - 5, 100);

    doc.fontSize(13)
      .text("Instructions", 60, yStart);

    doc.moveDown(1);

    doc.fontSize(11)
      .text("• Bring a valid photo ID")
      .text("• No payment required at the lab")
      .text("• Follow test-specific instructions above");

    doc.end();
  });
}
