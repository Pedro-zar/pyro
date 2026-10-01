/*
 * Macro de exportação das runas: cole numa macro de script do Foundry, com o
 * mundo aberto e logado como Mestre, e execute. Ela baixa um
 * pyro-runas.json com as runas soltas no mundo e as que estão nas fichas,
 * para comparar com o compêndio de runas (tools/gerar-runas.mjs).
 *
 * As das fichas vão junto porque runa feita direto num personagem nunca
 * passa pela pasta do mundo, e é dela que as magias salvas dependem.
 */
const runa = (item, ficha = null) => ({ ...item.toObject(), ficha });

const dados = {
  sistema: game.system.id,
  exportado: new Date().toISOString(),
  pastas: game.folders.filter(f => f.type === "Item").map(f => f.toObject()),
  mundo: game.items.filter(i => i.type === "runa").map(i => runa(i)),
  fichas: game.actors.contents.flatMap(a =>
    a.items.filter(i => i.type === "runa").map(i => runa(i, a.name)))
};

foundry.utils.saveDataToFile(JSON.stringify(dados, null, 2), "application/json", "pyro-runas.json");
ui.notifications.info(`Exportadas ${dados.mundo.length} runas do mundo e ${dados.fichas.length} das fichas.`);
