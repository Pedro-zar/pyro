/**
 * Compila os JSON de packs/_source/ no formato LevelDB que o Foundry v13 lê.
 *
 * Depois de compilar, o script relê o pack e compara com a origem: um item que
 * entrou torto aparece aqui, e não na mesa. Também avisa quais arquivos da
 * pasta do pack sobraram da compilação anterior — o LevelDB numera os próprios
 * arquivos, e um resto antigo pode ficar para trás numa atualização.
 *
 *   npm install && node tools/compilar-packs.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { compilePack, extractPack } from "@foundryvtt/foundryvtt-cli";

const RAIZ = path.resolve(import.meta.dirname, "..");
const ORIGEM = path.join(RAIZ, "packs", "_source");
const DESTINO = path.join(RAIZ, "packs");

/** Ignora o que não muda o conteúdo: log é diagnóstico, LOCK é do processo. */
const RUIDO = new Set(["LOG", "LOG.old", "LOCK"]);
const arquivosDoPack = dir =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => !RUIDO.has(f)).sort() : [];

async function compilar(nome) {
  const origem = path.join(ORIGEM, nome);
  const destino = path.join(DESTINO, nome);
  const antes = arquivosDoPack(destino);

  // Pasta limpa: sobra de compilação anterior confunde a comparação abaixo.
  fs.rmSync(destino, { recursive: true, force: true });
  await compilePack(origem, destino);

  /* --- Confere lendo de volta -------------------------------------------- */
  const conferencia = path.join(RAIZ, ".tmp-conferencia", nome);
  fs.rmSync(conferencia, { recursive: true, force: true });
  await extractPack(destino, conferencia);

  /*
   * Compara conteúdo, não formatação: o empacotador reordena as chaves e
   * acrescenta metadados próprios (_key, _stats), o que não é diferença real.
   */
  const normalizar = valor => {
    if (Array.isArray(valor)) return valor.map(normalizar);
    if (valor && typeof valor === "object") {
      return Object.fromEntries(Object.entries(valor)
        .filter(([k]) => k !== "_key" && k !== "_stats")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, normalizar(v)]));
    }
    return valor;
  };

  const ler = dir => Object.fromEntries(fs.readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      return [doc._id, normalizar(doc)];
    }));

  const escrito = ler(origem);
  const lido = ler(conferencia);
  fs.rmSync(path.join(RAIZ, ".tmp-conferencia"), { recursive: true, force: true });

  const perdidos = Object.keys(escrito).filter(id => !lido[id]);
  const diferentes = Object.keys(escrito).filter(id => lido[id]
    && JSON.stringify(lido[id]) !== JSON.stringify(escrito[id]));

  const depois = arquivosDoPack(destino);
  const orfaos = antes.filter(f => !depois.includes(f));

  return { nome, total: Object.keys(escrito).length, perdidos, diferentes, orfaos };
}

const packs = fs.readdirSync(ORIGEM, { withFileTypes: true })
  .filter(e => e.isDirectory()).map(e => e.name);

let falhou = false;
for (const nome of packs) {
  const r = await compilar(nome);
  console.log(`${r.nome}: ${r.total} documentos`);
  if (r.perdidos.length) {
    falhou = true;
    console.log(`  NÃO ENTRARAM: ${r.perdidos.join(", ")}`);
  }
  if (r.diferentes.length) {
    falhou = true;
    console.log(`  SAÍRAM DIFERENTES: ${r.diferentes.join(", ")}`);
  }
  if (!r.perdidos.length && !r.diferentes.length) {
    console.log("  ida e volta conferem");
  }
  if (r.orfaos.length) {
    console.log(`  apagar da pasta do pack no destino: ${r.orfaos.join(", ")}`);
  }
}

process.exit(falhou ? 1 : 0);
