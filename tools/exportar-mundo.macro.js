/*
 * Macro de exportação: cole numa macro de script do Foundry (tipo "script"),
 * com o mundo aberto e logado como Mestre, e execute. Ela baixa um
 * pyro-export.json com os caminhos, habilidades, técnicas, feitiços, magias e
 * perícias do mundo, as pastas deles e os valores padrão de cada tipo.
 *
 * O arquivo vai para tools/pyro-export.json e o
 *   node tools/importar-mundo.mjs tools/pyro-export.json
 * transforma tudo nos arquivos de tools/compendios/.
 *
 * Os padrões vão junto porque o importador tira dos arquivos o que é igual ao
 * padrão do tipo: sem eles não daria para saber o que foi escrito de
 * propósito e o que é só o campo vazio de sempre.
 */
const TIPOS = ["caminho", "habilidade", "tecnica", "feitico", "magia", "pericia"];

const itens = game.items.filter(i => TIPOS.includes(i.type));
const pastas = game.folders.filter(f => f.type === "Item");
const padroes = Object.fromEntries(TIPOS.map(tipo => [
  tipo, new Item.implementation({ name: "padrão", type: tipo }).toObject().system
]));

const dados = {
  sistema: game.system.id,
  versao: game.system.version,
  exportado: new Date().toISOString(),
  padroes,
  pastas: pastas.map(f => f.toObject()),
  itens: itens.map(i => i.toObject())
};

foundry.utils.saveDataToFile(JSON.stringify(dados, null, 2), "application/json", "pyro-export.json");
ui.notifications.info(`Exportados ${itens.length} itens e ${pastas.length} pastas.`);
