// Known-good values per module, read from the reference PDFs.
// Shared by the LLM probe and the A/B eval.

export const TRUTH = {
  trolley: {
    productType: 'trolley',
    drawingNo: 'LSB-2607-003-RHC-R00',
    revision: '00',
    customer: 'RAHABCO ENGINEERING & CONSTRUCTION SDN BHD',
    productName: 'ALUMINIUM SAFETY LADDER TROLLEY 9 STEP (CUSTOMIZED)',
    steps: 9, angle: '60', overallHeight: 3500, workingLoad: '150KG',
    platformLength: 980, overallWidth: 700, footprint: 2372, material: 'Aluminium', finishing: 'MF',
  },
  cage: {
    productType: 'cage',
    drawingNo: 'LSB/2607/004/FHL/R00',
    revision: '00',
    customer: 'FHL CONSTRUCTION SDN BHD',
    material: 'Aluminium', finishing: 'MF', workingLoad: '150KG',
    floorToLanding: 6650, handrailHeight: 900, ladderWidth: 450,
  },
  cat: {
    productType: 'cat',
    drawingNo: 'LSB/2609/007/FHL/R00',
    revision: '00',
    customer: 'FHL CONSTRUCTION SDN BHD',
    productName: 'ALUMINIUM CAT LADDER BODY TYPE',
    material: 'Aluminium', finishing: 'MF', workingLoad: '150KG', date: '07-09-2026', overallHeight: 3200,
  },
};

export const FIELDS = {
  trolley: ['productType', 'drawingNo', 'revision', 'customer', 'productName', 'steps', 'angle',
    'overallHeight', 'workingLoad', 'platformLength', 'overallWidth', 'footprint', 'material', 'finishing'],
  cage: ['productType', 'drawingNo', 'revision', 'customer', 'material', 'finishing', 'workingLoad',
    'floorToLanding', 'handrailHeight', 'ladderWidth'],
  cat: ['productType', 'drawingNo', 'revision', 'customer', 'productName', 'material', 'finishing',
    'workingLoad', 'date', 'overallHeight'],
};

export const norm = (v) => (v == null ? '' : String(v).toLowerCase().replace(/[\s,]/g, ''));
export const eq = (a, b) => norm(a) === norm(b) || (typeof b === 'number' && Number(a) === b);
