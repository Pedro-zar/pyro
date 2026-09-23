/**
 * Ponto de entrada do sistema: registra documentos, data models, fichas,
 * settings, helpers e os hooks globais.
 */

import { PYRO } from "./config.mjs";
import { PersonagemData, NpcData, GrupoData } from "./data/actor-data.mjs";
import {
  ArmaData, EquipamentoData, ConsumivelData, HabilidadeData, TecnicaData,
  FeiticoData, RunaData, MagiaData, CaminhoData, PericiaData
} from "./data/item-data.mjs";
import { PyroActor } from "./documents/actor.mjs";
import { PyroItem } from "./documents/item.mjs";
import { PyroActiveEffect } from "./documents/active-effect.mjs";
import { PyroTokenDocument } from "./documents/token.mjs";
import { PyroActorSheet } from "./sheets/actor-sheet.mjs";
import { PyroGrupoSheet } from "./sheets/grupo-sheet.mjs";
import { PyroItemSheet } from "./sheets/item-sheet.mjs";
import { registrarSettings, aplicarSettings } from "./settings.mjs";
import { registrarMenuChat } from "./chat.mjs";
import { registrarRelogio } from "./tempo.mjs";
import { registrarPercepcao } from "./percepcao.mjs";
import { registrarRegioes } from "./regioes.mjs";
import { SYSTEM_ID, flagsDe, caminho } from "./sistema.mjs";

Hooks.once("init", () => {
  console.log(`PYRO | Inicializando sistema (id: ${SYSTEM_ID})`);

  // Tabelas de regras editáveis pelo mestre (Configurações > Sistema).
  registrarSettings();
  aplicarSettings();

  // Efeitos de itens aplicam direto no ator, sem cópia no documento do ator.
  CONFIG.ActiveEffect.legacyTransferral = false;

  Handlebars.registerHelper("pyroEhOutro", v => v === "outro");
  Handlebars.registerHelper("pyroInclui", (lista, valor) => Array.isArray(lista) && lista.includes(valor));
  // Ternário inline: {{localize (pyroSe editando "A" "B")}}.
  Handlebars.registerHelper("pyroSe", (cond, sim, nao) => (cond ? sim : nao));
  /*
   * Parágrafo de dica que some quando a dica foi esvaziada no idioma: quem
   * tirou o texto quis a tela mais limpa, e um <p> vazio continuaria ocupando
   * o espaço dele.
   */
  Handlebars.registerHelper("pyroDica", chave => {
    const texto = game.i18n.localize(chave).trim();
    if (!texto || texto === chave) return "";
    return new Handlebars.SafeString(
      `<p class="pyro-nota">${Handlebars.escapeExpression(texto)}</p>`);
  });
  // A linha de escalonamento chamada "Dano" é a única com dados (faces) e
  // multiplicador por Intenção; as outras são números que somam.
  Handlebars.registerHelper("pyroEhDano", nome => PYRO.normalizarTexto(nome) === "dano");

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
  CONFIG.Token.documentClass = PyroTokenDocument;

  // Sentidos espirituais: detecção através de paredes e as aparências.
  registrarPercepcao();
  // Regiões de densidade espiritual (quanta mana há no ar de cada lugar).
  registrarRegioes();

  CONFIG.Actor.dataModels = {
    personagem: PersonagemData,
    npc: NpcData,
    grupo: GrupoData
  };
  CONFIG.Item.dataModels = {
    arma: ArmaData,
    equipamento: EquipamentoData,
    consumivel: ConsumivelData,
    habilidade: HabilidadeData,
    tecnica: TecnicaData,
    feitico: FeiticoData,
    pericia: PericiaData,
    runa: RunaData,
    magia: MagiaData,
    caminho: CaminhoData
  };

  // Iniciativa: rola a pool de AGI. "@dados.agi" é uma string de fórmula
  // ("3d6") vinda de getRollData — a Roll inlina strings antes de parsear.
  CONFIG.Combat.initiative = { formula: "@dados.agi", decimals: 2 };

  registrarMenuChat();
  // Cada turno do combate vale 6 segundos para todos em cena (SRD §1).
  registrarRelogio();

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
    "pyro.secao": caminho("templates/actor/partials/secao.hbs"),
    "pyro.progresso": caminho("templates/item/partials/progresso.hbs"),
    "pyro.efeito-linha": caminho("templates/item/partials/efeito-linha.hbs"),
    "pyro.previa": caminho("templates/apps/previa.hbs")
  });

  const { Actors, Items } = foundry.documents.collections;
  Actors.unregisterSheet("core", foundry.appv1.sheets.ActorSheet);
  Actors.registerSheet(SYSTEM_ID, PyroActorSheet, {
    types: ["personagem", "npc"], makeDefault: true, label: "PYRO.FichaAtor"
  });
  Actors.registerSheet(SYSTEM_ID, PyroGrupoSheet, {
    types: ["grupo"], makeDefault: true, label: "PYRO.FichaGrupo"
  });
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
/** Ator dono de um item ou de um efeito (o efeito pode estar num item do ator). */
const atorDoDocumento = doc => (doc?.parent instanceof Actor ? doc.parent : doc?.parent?.parent);

Hooks.on("updateActor", sincronizarTamanho);
Hooks.on("createItem", doc => sincronizarTamanho(atorDoDocumento(doc)));
Hooks.on("updateItem", doc => sincronizarTamanho(atorDoDocumento(doc)));
Hooks.on("deleteItem", doc => sincronizarTamanho(atorDoDocumento(doc)));
Hooks.on("createActiveEffect", doc => sincronizarTamanho(atorDoDocumento(doc)));
Hooks.on("updateActiveEffect", doc => sincronizarTamanho(atorDoDocumento(doc)));
Hooks.on("deleteActiveEffect", doc => sincronizarTamanho(atorDoDocumento(doc)));

/*
 * O prazo da transformação mora num efeito marcador; quando ele morre — o
 * relógio o venceu, ou alguém o apagou na ficha — a forma acaba junto.
 *
 * Quem responde é o cliente que apagou o marcador, e não o mestre: um jogador
 * pode passar o tempo pelo Grupo e apagar o marcador da própria ficha numa
 * mesa sem mestre conectado, e ali a forma ficaria ligada para sempre. Quem
 * pôde apagar o efeito é dono do ator, então pode acabar a forma.
 *
 * A saída não é esperada de propósito: este gancho dispara de dentro do
 * relógio, que já corre na fila do ator. Ela entra na fila e roda em seguida.
 */
Hooks.on("deleteActiveEffect", (efeito, opcoes, userId) => {
  if (game.user.id !== userId) return;
  const ator = efeito?.parent;
  const forma = flagsDe(efeito)?.transformacao;
  if (!forma || !(ator instanceof Actor)) return;
  // Numa troca de forma a flag já aponta para a nova, e o marcador que está
  // sendo apagado é o da antiga: nada acabou.
  if (ator.getFlag(SYSTEM_ID, "transformacao") !== forma) return;
  // O card do turno já anuncia o prazo vencido junto com os outros efeitos.
  ator.sairDaTransformacao({ aviso: !opcoes?.pyroRelatado })
    .catch(erro => console.error("PYRO | falha ao acabar a transformação", erro));
});

/*
 * A habilidade que dá a forma sumiu da ficha: o marcador dela não tem mais
 * dono, e uma forma sem prazo ficaria pendurada no ator para sempre.
 */
Hooks.on("deleteItem", (item, opcoes, userId) => {
  if (game.user.id !== userId) return;
  const ator = item?.parent;
  if (!(ator instanceof Actor)) return;
  if (ator.getFlag(SYSTEM_ID, "transformacao") !== item.id) return;
  ator.sairDaTransformacao()
    .catch(erro => console.error("PYRO | falha ao acabar a transformação", erro));
});

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
