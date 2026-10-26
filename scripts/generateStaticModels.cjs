const fs = require('fs');
const path = require('path');

const baseDir = path.join(__dirname, '..', 'public', 'models');
const prongsDir = path.join(baseDir, '4 PRONG');
const shankDir = path.join(baseDir, 'Shank');

const shapeFolders = fs.readdirSync(prongsDir);

const shapesData = [];

shapeFolders.forEach((folder) => {
  const shapeName = folder.replace('4 PRONG TALON ', '').trim();
  const folderPath = path.join(prongsDir, folder);
  const files = fs.readdirSync(folderPath);

  const carats = [];
  files.forEach((file) => {
    const match = file.match(/(\d+(?:\.\d+)?)\s*CT\.glb$/i);
    if (match) {
      const caratVal = parseFloat(match[1]);
      carats.push({
        carat: caratVal,
        label: `${caratVal} CT`,
        file: `/models/4 PRONG/${folder}/${file}`,
        filename: file,
      });
    }
  });

  carats.sort((a, b) => a.carat - b.carat);

  shapesData.push({
    id: shapeName.toLowerCase(),
    name: shapeName.charAt(0) + shapeName.slice(1).toLowerCase(),
    folder: folder,
    carats: carats,
  });
});

// Sort shapes nicely
const shapeOrder = [
  'round',
  'oval',
  'emerald',
  'cushion',
  'pear',
  'princess',
  'radiant',
  'asscher',
  'marquise',
  'heart',
];
shapesData.sort((a, b) => {
  const idxA = shapeOrder.indexOf(a.id);
  const idxB = shapeOrder.indexOf(b.id);
  return (idxA >= 0 ? idxA : 99) - (idxB >= 0 ? idxB : 99);
});

const shankFiles = fs.readdirSync(shankDir).filter((f) => f.endsWith('.glb'));
const shanksData = shankFiles.map((file) => {
  const baseName = file.replace(/\.glb$/i, '').trim();
  const displayName = baseName
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  let category = 'Solitaire & Classic';
  const upper = baseName.toUpperCase();
  if (
    upper.includes('PAVE') ||
    upper.includes('BAGUETTE') ||
    upper.includes('STONE') ||
    upper.includes('ETERNITY') ||
    upper.includes('SCATTER') ||
    upper.includes('CHANNEL')
  ) {
    category = 'Pavé & Diamond Accent';
  } else if (
    upper.includes('TWIST') ||
    upper.includes('WAVE') ||
    upper.includes('CURVE') ||
    upper.includes('BYPASS')
  ) {
    category = 'Twist & Curved';
  } else if (
    upper.includes('ROW') ||
    upper.includes('TRIPLE') ||
    upper.includes('DOUBLE')
  ) {
    category = 'Multi-Row Band';
  } else if (
    upper.includes('VINE') ||
    upper.includes('PETAL') ||
    upper.includes('FLOWER') ||
    upper.includes('ROPE')
  ) {
    category = 'Floral & Textured';
  } else if (
    upper.includes('CROW') ||
    upper.includes('ARCH') ||
    upper.includes('COLLAR') ||
    upper.includes('CATHREDRAL') ||
    upper.includes('MOON')
  ) {
    category = 'Cathedral & Architectural';
  }

  return {
    id: baseName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
    name: displayName,
    rawName: baseName,
    file: `/models/Shank/${file}`,
    category: category,
  };
});

shanksData.sort((a, b) => a.name.localeCompare(b.name));

const outContent = `// Auto-generated static model catalog for Ring Builder

export interface CaratOption {
  carat: number;
  label: string;
  file: string;
  filename: string;
}

export interface DiamondShape {
  id: string;
  name: string;
  folder: string;
  carats: CaratOption[];
}

export interface ShankOption {
  id: string;
  name: string;
  rawName: string;
  file: string;
  category: string;
}

export interface MetalOption {
  id: string;
  name: string;
  hexCode: string;
  previewColor: string;
  gradient: string;
  description: string;
}

export const STATIC_DIAMOND_SHAPES: DiamondShape[] = ${JSON.stringify(shapesData, null, 2)};

export const STATIC_SHANKS: ShankOption[] = ${JSON.stringify(shanksData, null, 2)};

export const STATIC_METALS: MetalOption[] = [
  {
    id: "white_gold",
    name: "14K White Gold",
    hexCode: "#C2C2C3",
    previewColor: "#C2C2C3",
    gradient: "linear-gradient(135deg, #FFFFFF 0%, #D8D8DA 50%, #A8A8AC 100%)",
    description: "Lustrous cool tone with brilliant rhodium sheen"
  },
  {
    id: "yellow_gold",
    name: "18K Yellow Gold",
    hexCode: "#E3BB5E",
    previewColor: "#E3BB5E",
    gradient: "linear-gradient(135deg, #FFE89E 0%, #E3BB5E 50%, #B88E28 100%)",
    description: "Warm, radiant classic luxury gold"
  },
  {
    id: "rose_gold",
    name: "18K Rose Gold",
    hexCode: "#D9A483",
    previewColor: "#D9A483",
    gradient: "linear-gradient(135deg, #FFCEB5 0%, #D9A483 50%, #B07452 100%)",
    description: "Romantic warm blush with copper undertones"
  }
];

export const DEFAULT_RING_CONFIG = {
  shapeId: "round",
  carat: 2.0,
  shankId: "traditional-solitaire",
  metalId: "white_gold",
  headScale: 0.17,
  shankScale: 0.17,
};
`;

const targetFile = path.join(__dirname, '..', 'src', 'config', 'staticModels.ts');
fs.writeFileSync(targetFile, outContent, 'utf8');
console.log('Successfully wrote', targetFile);
