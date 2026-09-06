import { PYRO } from "./config.mjs";
import { PersonagemData, NpcData } from "./data/actor-data.mjs";
import {
  ArmaData, EquipamentoData, ConsumivelData, HabilidadeData,
  FeiticoData, RunaData, MagiaData, CaminhoData
} from "./data/item-data.mjs";
import { PyroActor } from "./documents/actor.mjs";
import { PyroItem } from "./documents/item.mjs";
import { PyroActiveEffect } from "./documents/active-effect.mjs";
import { PyroActorSheet } from "./sheets/actor-sheet.mjs";
import { PyroItemSheet } from "./sheets/item-sheet.mjs";
import { registrarSettings, aplicarSettings } from "./settings.mjs";
import { registrarMenuChat } from "./chat.mjs";
import { SYSTEM_ID, caminho } from "./sistema.mjs";

Hooks.once("init", () => {
  console.log(`PYRO | Inicializando sistema (id: ${SYSTEM_ID})`);

  // Tabelas de magia editáveis pelo mestre (Configurações > Sistema).
  registrarSettings();
  aplicarSettings();

  // Efeitos de itens aplicam dinamicamente no ator (sem cópia legada).
  CONFIG.ActiveEffect.legacyTransferral = false;

  // Helper usado na ficha de item (afinidade "outro" mostra o campo de texto).
  Handlebars.registerHelper("pyroEhOutro", v => v === "outro");
  Handlebars.registerHelper("pyroInclui", (lista, valor) => Array.isArray(lista) && lista.includes(valor));
  // Ternário inline: {{localize (pyroSe editando "A" "B")}}.
  Handlebars.registerHelper("pyroSe", (cond, sim, nao) => (cond ? sim : nao));

  CONFIG.PYRO = PYRO;

  // Condições do sistema no HUD do token, somadas às padrão do Foundry.
  for (const [id, cfg] of Object.entries(PYRO.condicoes)) {
    if (!CONFIG.statusEffects.some(s => s.id === id)) {
      CONFIG.statusEffects.push({ id, name: cfg.label, img: cfg.img });
    }
  }
  CONFIG.Actor.documentClass = PyroActor;
  CONFIG.Item.documentClass = PyroItem;
  CONFIG.ActiveEffect.documentClass = PyroActiveEffect;

  CONFIG.Actor.dataModels = {
    personagem: PersonagemData,
    npc: NpcData
  };
  CONFIG.Item.dataModels = {
    arma: ArmaData,
    equipamento: EquipamentoData,
    consumivel: ConsumivelData,
    habilidade: HabilidadeData,
    feitico: FeiticoData,
    runa: RunaData,
    magia: MagiaData,
    caminho: CaminhoData
  };

  // Iniciativa: rola a pool de AGI. "@dados.agi" é uma string de fórmula
  // ("3d6") vinda de getRollData — a Roll inlina strings antes de parsear.
  CONFIG.Combat.initiative = { formula: "@dados.agi", decimals: 2 };

  registrarMenuChat();

  // Fontes do sistema, também disponíveis nos editores de texto.
  CONFIG.fontDefinitions["PyroDisplay"] = {
    editor: true,
    fonts: [{ urls: [caminho("fonts/Cinzel.woff2")], weight: "400 900" }]
  };
  CONFIG.fontDefinitions["PyroTexto"] = {
    editor: true,
    fonts: [{ urls: [caminho("fonts/Inter.woff2")], weight: "100 900" }]
  };

  // Partials usados por todas as listas da ficha.
  // Registrados por nome curto: os .hbs chamam {{> "pyro.secao"}} sem
  // depender do id da pasta (ver sistema.mjs).
  foundry.applications.handlebars.loadTemplates({
    "pyro.item-linha": caminho("templates/actor/partials/item-linha.hbs"),
    "pyro.secao": caminho("templates/actor/partials/secao.hbs")
  });

  const { Actors, Items } = foundry.documents.collections;
  Actors.unregisterSheet("core", foundry.appv1.sheets.ActorSheet);
  Actors.registerSheet(SYSTEM_ID, PyroActorSheet, { makeDefault: true, label: "PYRO.FichaAtor" });
  Items.unregisterSheet("core", foundry.appv1.sheets.ItemSheet);
  Items.registerSheet(SYSTEM_ID, PyroItemSheet, { makeDefault: true, label: "PYRO.FichaItem" });
});

// As afinidades derivam dos elementos e usam rótulos traduzidos.
Hooks.once("i18nInit", () => PYRO.construirAfinidades());

/*
 * O tamanho da criatura vem de caminho racial, efeito ou edição direta, então
 * a reação a ele escuta todas essas origens — é ela que redesenha o token e
 * ajusta o PV em proporção. O método sai cedo quando o tamanho não mudou, o
 * que evita laço com o próprio updateActor que ele mesmo dispara.
 */
const sincronizarTamanho = actor => actor?.aplicarMudancaDeTamanho?.();
const donoDoItem = doc => (doc?.parent instanceof Actor ? doc.parent : doc?.parent?.parent);

Hooks.on("updateActor", sincronizarTamanho);
Hooks.on("createItem", doc => sincronizarTamanho(donoDoItem(doc)));
Hooks.on("updateItem", doc => sincronizarTamanho(donoDoItem(doc)));
Hooks.on("deleteItem", doc => sincronizarTamanho(donoDoItem(doc)));
Hooks.on("createActiveEffect", doc => sincronizarTamanho(donoDoItem(doc)));
Hooks.on("updateActiveEffect", doc => sincronizarTamanho(donoDoItem(doc)));
Hooks.on("deleteActiveEffect", doc => sincronizarTamanho(donoDoItem(doc)));

/**
 * Diagnóstico: se as chaves não resolverem, o arquivo de idioma não foi
 * carregado (normalmente porque o idioma do cliente não é um dos registrados
 * em system.json). Sem isso a ficha aparece com "PYRO.Tabs.principal" etc.
 */
Hooks.once("ready", () => {
  if (game.i18n.localize("PYRO.DET") !== "PYRO.DET") return;
  const aviso = "PYRO | Traduções não carregadas. Troque o idioma em Configurações "
    + "> Definições do Jogo > Idioma para Português (Brasil) e recarregue.";
  console.warn(aviso);
  if (game.user.isGM) ui.notifications.warn(aviso, { permanent: true });
});
