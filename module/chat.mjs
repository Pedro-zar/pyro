/**
 * Chat do PYRO: menu de contexto das mensagens, o rodapé dos cards do sistema
 * — fichas de dano por tipo e botões de aplicar dano/cura direto no card — e
 * os botões que agem sobre a rolagem já feita (contar uso, Sorte).
 * Menu e rodapé aplicam a mesma coisa; o rodapé é o caminho principal.
 */

import { PYRO } from "./config.mjs";
import { dadosDoEfeitoAplicado, variaveisDaMensagem } from "./efeitos.mjs";
import { esc } from "./ui.mjs";
import { SYSTEM_ID, flagsDe, flagsDoSistema } from "./sistema.mjs";
import { registrarUso } from "./progressao.mjs";
import {
  aplicarQueimando, aplicarMolhado, aplicarFriagem, efeitoComPrazo, pilhasDe
} from "./condicoes.mjs";

/** Linha de sucesso ou falha contra um ND, nos cards de teste. */
export function htmlResultadoND(sucesso) {
  return `<p class="pyro-resultado ${sucesso ? "sucesso" : "falha"}">
    ${game.i18n.localize(sucesso ? "PYRO.Chat.Sucesso" : "PYRO.Chat.Falha")}</p>`;
}

/** Card de pool zerada por desvantagens. */
export function htmlFalhaAutomatica() {
  return `<p class="pyro-falha-auto">${game.i18n.localize("PYRO.Chat.FalhaAutomatica")}</p>`;
}

/**
 * Botão de Sorte (SRD Atributos): por 1 ponto de Força de Vontade, re-rola os
 * dados escolhidos de uma rolagem recém feita. Só entra em card que tenha
 * dados para re-rolar; quem não tem ponto vê o aviso ao clicar, e não um
 * botão que some — a regra existe mesmo quando o personagem não pode pagá-la.
 */
export function htmlBotaoSorte() {
  return `<div class="pyro-sorte-linha">
    <button type="button" class="pyro-sorte">
      <i class="fa-solid fa-clover"></i> ${game.i18n.localize("PYRO.Vontade.Sorte")}
    </button>
  </div>`;
}

/**
 * Atores alvo da aplicação: tokens selecionados, ou o personagem do usuário.
 * Dois tokens do mesmo ator vinculado são a mesma pessoa — sem tirar o repetido
 * o dano cairia duas vezes sobre ela.
 */
function alvos() {
  const selecionados = canvas.tokens?.controlled?.map(t => t.actor).filter(Boolean) ?? [];
  if (selecionados.length) {
    const vistos = new Set();
    return selecionados.filter(a => {
      if (vistos.has(a.uuid)) return false;
      vistos.add(a.uuid);
      return true;
    });
  }
  return game.user.character ? [game.user.character] : [];
}

/** Quem conjurou a magia daquele card, para os efeitos que voltam ao próprio. */
function conjurador(message) {
  const speaker = message?.speaker;
  const token = speaker?.token ? canvas.tokens?.get(speaker.token)?.actor : null;
  return token ?? (speaker?.actor ? game.actors.get(speaker.actor) : null);
}

/** Mensagem a partir do elemento da lista (aceita HTMLElement ou jQuery). */
function mensagemDe(li) {
  const el = li instanceof HTMLElement ? li : li?.[0];
  const id = el?.dataset?.messageId ?? li?.data?.("messageId");
  return game.messages.get(id);
}

/**
 * Totais da mensagem. Cards do sistema gravam o dano separado por tipo (pra
 * defesa ser descontada parcela a parcela) e a cura à parte. Mensagens simples
 * caem na soma das rolagens, sem tipo — nesse caso não há defesa a aplicar.
 */
function totais(message) {
  const flags = flagsDe(message);
  if (flags?.danos || flags?.cura !== undefined) {
    return {
      danos: flags.danos ?? [],
      cura: flags.cura ?? 0,
      // Qual recurso o dano mental drena foi decidido por quem atacou, e vem
      // no card (SRD §6). Sem declaração, a mana.
      recursoMental: flags.recursoMental ?? "mana"
    };
  }
  const soma = (message?.rolls ?? []).reduce((t, r) => t + (r.total ?? 0), 0);
  return { danos: [{ tipo: "", total: soma }], cura: soma, recursoMental: "mana" };
}

function temRolagem(li) {
  const msg = mensagemDe(li);
  return !!msg && ((msg.rolls?.length > 0) || !!flagsDe(msg));
}

/** Aplica em todos os alvos e resume num único aviso. */
async function aplicarEm(msg, tipo, multiplicador = 1) {
  if (!msg) return;
  const { danos, cura, recursoMental } = totais(msg);
  const destinos = alvos();

  if (!destinos.length) {
    return ui.notifications.warn(game.i18n.localize("PYRO.Avisos.SemAlvoSelecionado"));
  }

  const resumos = [];
  for (const actor of destinos) {
    if (!actor.isOwner) {
      ui.notifications.warn(game.i18n.format("PYRO.Avisos.SemPermissao", { nome: actor.name }));
      continue;
    }
    const somaBruta = danos.reduce((soma, d) => soma + d.total, 0);
    if (tipo === "cura") resumos.push(await actor.aplicarCura(cura * multiplicador));
    else if (tipo === "estamina") resumos.push(await actor.aplicarEstamina(somaBruta * multiplicador));
    else if (tipo === "mental") {
      resumos.push(await actor.aplicarDano(danos, { multiplicador, mental: true, recursoMental }));
    }
    else if (tipo === "cheio") {
      resumos.push(await actor.aplicarDano(danos, { multiplicador, ignorarDefesa: true, recursoMental }));
    }
    else resumos.push(await actor.aplicarDano(danos, { multiplicador, recursoMental }));
  }
  if (resumos.length) ui.notifications.info(resumos.join(" · "));
}

async function aplicar(li, tipo, multiplicador = 1) {
  return aplicarEm(mensagemDe(li), tipo, multiplicador);
}

/** Itens do menu, na ordem em que aparecem. */
function opcoes() {
  return [
    {
      name: "PYRO.Chat.AplicarDano",
      icon: '<i class="fa-solid fa-heart-crack"></i>',
      condition: temRolagem,
      callback: li => aplicar(li, "dano", 1)
    },
    {
      name: "PYRO.Chat.AplicarMetade",
      icon: '<i class="fa-solid fa-heart-crack"></i>',
      condition: temRolagem,
      callback: li => aplicar(li, "dano", 0.5)
    },
    {
      name: "PYRO.Chat.AplicarDobro",
      icon: '<i class="fa-solid fa-burst"></i>',
      condition: temRolagem,
      callback: li => aplicar(li, "dano", 2)
    },
    {
      name: "PYRO.Chat.AplicarCheio",
      icon: '<i class="fa-solid fa-shield-slash"></i>',
      condition: temRolagem,
      callback: li => aplicar(li, "cheio", 1)
    },
    {
      name: "PYRO.Chat.AplicarMental",
      icon: '<i class="fa-solid fa-brain"></i>',
      condition: temRolagem,
      callback: li => aplicar(li, "mental", 1)
    },
    {
      name: "PYRO.Chat.AplicarCura",
      icon: '<i class="fa-solid fa-heart"></i>',
      condition: temRolagem,
      callback: li => aplicar(li, "cura", 1)
    },
    {
      name: "PYRO.Chat.AplicarEstamina",
      icon: '<i class="fa-solid fa-wind"></i>',
      condition: temRolagem,
      callback: li => aplicar(li, "estamina", 1)
    }
  ];
}

/* -------------------------------------------------------------------------- */
/*  Rodapé dos cards: fichas de dano por tipo + botões de aplicar             */
/* -------------------------------------------------------------------------- */

/**
 * Rodapé dos cards do sistema (mensagens com as flags do sistema): fichas
 * com o dano somado por tipo e botões que aplicam nos tokens selecionados,
 * igual ao menu de contexto.
 */
function injetarRodape(message, element) {
  const flags = flagsDe(message);
  if (!flags) return;
  const danos = flags.danos ?? [];
  const cura = flags.cura ?? 0;
  if (!danos.length && !cura) return;

  const loc = k => game.i18n.localize(k);

  // Rolagem genérica (habilidade/feitiço sem tipo): um valor só, que pode
  // virar dano, cura ou estamina — sem ficha duplicada.
  const generico = danos.length === 1 && !danos[0].tipo && cura === danos[0].total;

  /* --- Fichas por tipo --------------------------------------------------- */
  const porTipo = new Map();
  for (const d of danos) {
    const chave = d.tipo || "simples";
    porTipo.set(chave, (porTipo.get(chave) ?? 0) + d.total);
  }
  const fichas = [...porTipo.entries()].map(([tipo, total]) => {
    const label = tipo !== "simples"
      ? esc(loc(CONFIG.PYRO.tiposDano[tipo]?.label ?? tipo)) : "";
    return `<span class="ficha-dano dano-${tipo}"><strong>${total}</strong>${label ? ` ${label}` : ""}</span>`;
  });
  if (cura && !generico) {
    fichas.push(`<span class="ficha-dano dano-cura"><strong>${cura}</strong> ${loc("PYRO.Chat.CuraChip")}</span>`);
  }

  /* --- Botões ------------------------------------------------------------ */
  const montarBotao = (modo, mult, titulo, conteudo) =>
    `<button type="button" class="pyro-aplicar" data-modo="${modo}" data-mult="${mult}"
             title="${loc(titulo)}">${conteudo}</button>`;
  const botoes = [];
  if (danos.length) {
    botoes.push(montarBotao("dano", 1, "PYRO.Chat.AplicarDano",
      `<i class="fa-solid fa-heart-crack"></i> ${loc("PYRO.Chat.BotAplicar")}`));
    botoes.push(montarBotao("dano", 0.5, "PYRO.Chat.AplicarMetade", "&frac12;"));
    botoes.push(montarBotao("dano", 2, "PYRO.Chat.AplicarDobro", "2&times;"));
    if (!generico) {
      botoes.push(montarBotao("cheio", 1, "PYRO.Chat.AplicarCheio", '<i class="fa-solid fa-shield-slash"></i>'));
    }
  }
  if (cura) {
    botoes.push(montarBotao("cura", 1, "PYRO.Chat.AplicarCura",
      `<i class="fa-solid fa-heart"></i> ${loc("PYRO.Chat.BotCurar")}`));
    botoes.push(montarBotao("estamina", 1, "PYRO.Chat.AplicarEstamina", '<i class="fa-solid fa-wind"></i>'));
  }

  const rodape = document.createElement("footer");
  rodape.className = "pyro-chat pyro-rodape-card";
  rodape.innerHTML = `
    <div class="pyro-fichas-dano">${fichas.join("")}</div>
    <div class="pyro-acoes-card">${botoes.join("")}</div>`;
  element.querySelector(".message-content")?.appendChild(rodape);

  rodape.querySelectorAll(".pyro-aplicar").forEach(b =>
    b.addEventListener("click", () =>
      aplicarEm(message, b.dataset.modo, Number(b.dataset.mult) || 1)));
}

/**
 * Botão do lembrete de postura: entra na postura clicada, ou troca para ela.
 *
 * O card fica no chat depois de clicado, e o destaque dele é o de quando foi
 * criado. Por isso este botão só entra: se ele alternasse, clicar de novo na
 * postura já ativa tiraria o personagem dela sem ninguém pedir.
 */
async function entrarNaPostura({ atorUuid, itemId }) {
  const actor = await fromUuid(atorUuid);
  if (!actor?.isOwner) return ui.notifications.warn(game.i18n.localize("PYRO.Avisos.SemPermissao"));
  const postura = actor.items.get(itemId);
  if (!postura) return ui.notifications.warn(game.i18n.localize("PYRO.Postura.Sumiu"));
  if (actor.posturaAtiva?.id === postura.id) {
    return ui.notifications.info(game.i18n.format("PYRO.Postura.JaEsta", { nome: postura.name }));
  }
  return actor.alternarPostura(postura);
}

export function registrarMenuChat() {
  Hooks.on("getChatMessageContextOptions", (html, options) => options.push(...opcoes()));

  Hooks.on("renderChatMessageHTML", (message, element) => {
    // Botões de efeito de uso nos cards: quem clica escolhe em quem aplicar.
    for (const botao of element.querySelectorAll(".pyro-aplicar-efeito")) {
      botao.addEventListener("click", () => aplicarEfeito(botao.dataset.efeitoUuid, message));
    }
    // Efeitos que a regra do elemento oferece (a defesa da pedra, por exemplo).
    for (const botao of element.querySelectorAll(".pyro-efeito-regra")) {
      botao.addEventListener("click", () => aplicarEfeitoDeRegra(message, Number(botao.dataset.indice)));
    }
    // Lembrete de postura do começo do combate: um clique entra na postura.
    for (const botao of element.querySelectorAll(".pyro-entrar-postura")) {
      botao.addEventListener("click", () => entrarNaPostura(botao.dataset));
    }
    prepararBotaoContarUso(message, element);
    prepararBotaoSobrecarga(message, element);
    prepararBotaoMira(message, element);
    prepararBotaoSorte(message, element);
    injetarRodape(message, element);
  });
}

/* -------------------------------------------------------------------------- */
/*  Sorte (Força de Vontade)                                                  */
/* -------------------------------------------------------------------------- */

/** Todos os dados ativos das rolagens de uma mensagem, achatados e numerados. */
function dadosDaMensagem(message) {
  const lista = [];
  (message?.rolls ?? []).forEach((roll, iRoll) => {
    roll.dice.forEach((termo, iTermo) => {
      termo.results.forEach((res, iRes) => {
        if (res.active === false) return;
        lista.push({ id: `${iRoll}.${iTermo}.${iRes}`, faces: termo.faces, valor: res.result });
      });
    });
  });
  return lista;
}

/**
 * Sorte: re-rola os dados que o jogador escolher, por 1 ponto de Força de
 * Vontade. O card original fica como está e o resultado sai num card novo —
 * a rolagem antiga é parte do que aconteceu na mesa, e reescrevê-la apagaria
 * o motivo de alguém ter gastado o ponto.
 */
function prepararBotaoSorte(message, element) {
  const botao = element.querySelector(".pyro-sorte");
  if (!botao) return;
  if (flagsDe(message)?.sorteUsada) {
    botao.disabled = true;
    botao.innerHTML = `<i class="fa-solid fa-check"></i> ${game.i18n.localize("PYRO.Vontade.SorteUsada")}`;
    return;
  }
  botao.addEventListener("click", () => usarSorte(message));
}

async function usarSorte(message) {
  const actor = ChatMessage.getSpeakerActor(message.speaker);
  if (!actor?.isOwner) {
    return ui.notifications.warn(game.i18n.localize("PYRO.Vontade.SemPermissao"));
  }
  if (actor.system.recursos.vontade.value < PYRO.CUSTO_SORTE) {
    return ui.notifications.warn(game.i18n.localize("PYRO.Avisos.SemVontade"));
  }
  const dados = dadosDaMensagem(message);
  if (!dados.length) return ui.notifications.warn(game.i18n.localize("PYRO.Vontade.SemDados"));

  const escolha = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("PYRO.Vontade.Sorte") },
    content: `<p class="hint">${game.i18n.localize("PYRO.Vontade.SorteDica")}</p>
      <div class="pyro-dados-sorte">${dados.map(d =>
        `<label class="dado-sorte"><input type="checkbox" name="${d.id}" />
          <span class="dado-valor numero">${d.valor}</span>
          <span class="dado-faces">d${d.faces}</span></label>`).join("")}</div>`,
    buttons: [
      { action: "ok", label: game.i18n.localize("PYRO.Vontade.ReRolar"), default: true,
        callback: (event, botao, dialogo) =>
          Array.from(dialogo.element.querySelectorAll("input:checked")).map(i => i.name) },
      { action: "cancelar", label: game.i18n.localize("PYRO.Cancelar") }
    ],
    rejectClose: false
  });
  if (!Array.isArray(escolha) || !escolha.length) return;

  const escolhidos = dados.filter(d => escolha.includes(d.id));
  const formula = escolhidos.map(d => `1d${d.faces}`).join(" + ");
  const roll = await new Roll(formula).evaluate();
  const antes = escolhidos.reduce((t, d) => t + d.valor, 0);
  const totalAntigo = (message.rolls ?? []).reduce((t, r) => t + (r.total ?? 0), 0);

  /*
   * A Força de Vontade é relida agora, e não antes do diálogo: a janela fica
   * aberta o tempo que o jogador quiser, e ele pode ter gasto os pontos em
   * outro teste nesse meio. Cobrar sobre o número antigo devolveria pontos já
   * gastos.
   */
  const disponivel = actor.system.recursos.vontade.value;
  if (disponivel < PYRO.CUSTO_SORTE) {
    return ui.notifications.warn(game.i18n.localize("PYRO.Avisos.SemVontade"));
  }
  await actor.update({ "system.recursos.vontade.value": disponivel - PYRO.CUSTO_SORTE });
  if (message.isAuthor || game.user.isGM) {
    await message.update({ [`flags.${SYSTEM_ID}.sorteUsada`]: true });
  }

  return ChatMessage.create({
    speaker: message.speaker,
    flavor: game.i18n.localize("PYRO.Vontade.Sorte"),
    content: `<div class="pyro-chat pyro-teste">
      <p class="pyro-nota">${game.i18n.format("PYRO.Vontade.SorteTrocou", {
        n: escolhidos.length, antes, depois: roll.total
      })}</p>
      ${await roll.render()}
      <p class="pyro-resultado">${game.i18n.format("PYRO.Vontade.SorteNovoTotal", {
        total: totalAntigo - antes + roll.total
      })}</p>
    </div>`,
    rolls: [roll],
    sound: CONFIG.sounds.dice
  });
}

/**
 * O botão de contar uso vale uma vez por card: depois de contado, a mensagem
 * guarda a marca e o botão fica travado em todos os clientes.
 */
/**
 * Grava no card que um botão já foi usado, relendo o estado da mensagem na
 * hora — dois cliques quase juntos gravariam listas montadas antes um do
 * outro, e a segunda apagaria a primeira.
 *
 * Só o autor e o mestre podem escrever numa mensagem: quando quem clicou não
 * é nenhum dos dois, a trava vale para a sessão dele e o card volta a
 * oferecer o botão depois de um F5. É o mesmo limite que o Foundry impõe a
 * qualquer marca em mensagem alheia.
 */
async function gravarMarca(message, campo, valor) {
  if (!(message.isAuthor || game.user.isGM)) return;
  if (valor === true) return message.update({ [`flags.${SYSTEM_ID}.${campo}`]: true });
  const atuais = new Set(flagsDe(message)?.[campo] ?? []);
  atuais.add(valor);
  return message.update({ [`flags.${SYSTEM_ID}.${campo}`]: [...atuais] });
}

function prepararBotaoContarUso(message, element) {
  // Uma rolagem pode contar para dois itens (a magia e a perícia de
  // sobrecarga), então cada botão se marca sozinho pelo uuid do seu item.
  const contados = new Set(flagsDe(message)?.usosContados ?? []);
  // Cards antigos guardavam só "já contou" sem dizer de quem; com um botão só
  // dá no mesmo.
  const tudoContado = !!flagsDe(message)?.usoContado;

  for (const botao of element.querySelectorAll(".pyro-contar-uso")) {
    const uuid = botao.dataset.itemUuid;
    const marcar = () => {
      botao.disabled = true;
      botao.innerHTML = `<i class="fa-solid fa-check"></i> ${game.i18n.localize("PYRO.Uso.Contado")}`;
    };
    if (tudoContado || contados.has(uuid)) {
      marcar();
      continue;
    }
    botao.addEventListener("click", async () => {
      const item = await fromUuid(uuid);
      if (!item?.isOwner) {
        return ui.notifications.warn(game.i18n.localize("PYRO.Uso.SemPermissao"));
      }
      // Trava antes de contar: contar uso é ida ao servidor, e um segundo
      // clique no meio dela contaria duas vezes o mesmo teste.
      botao.disabled = true;
      const resultado = await registrarUso(item, botao.dataset.classe);
      if (!resultado) {
        botao.disabled = false;
        return;
      }
      marcar();
      await gravarMarca(message, "usosContados", uuid);
    });
  }
}

/**
 * Teste de sobrecarga a partir do card: quem passou do limite clica quando
 * estiver pronto, e o diálogo abre com o ND e a exaustão da falha já dentro.
 */
function prepararBotaoSobrecarga(message, element) {
  for (const botao of element.querySelectorAll(".pyro-teste-sobrecarga")) {
    if (flagsDe(message)?.sobrecargaFeita) {
      botao.disabled = true;
      botao.innerHTML = `<i class="fa-solid fa-check"></i> ${game.i18n.localize("PYRO.Sobrecarga.Feito")}`;
      continue;
    }
    botao.addEventListener("click", async () => {
      const actor = await fromUuid(botao.dataset.atorUuid);
      if (!actor?.isOwner) {
        return ui.notifications.warn(game.i18n.localize("PYRO.Uso.SemPermissao"));
      }
      /*
       * Trava enquanto o diálogo está aberto: ele não é modal, e o card fica
       * clicável atrás dele — dois cliques virariam dois testes e exaustão
       * cobrada em dobro. Cancelar devolve o botão.
       */
      botao.disabled = true;
      const feito = await actor.rolarSobrecarga({
        nd: Number(botao.dataset.nd) || 0,
        exaustao: Number(botao.dataset.exaustao) || 0,
        atributo: botao.dataset.atributo,
        bonusAtributo: Number(botao.dataset.bonusAtributo) || 0,
        itemUuid: botao.dataset.itemUuid || null
      });
      if (!feito) {
        botao.disabled = false;
        return;
      }
      await gravarMarca(message, "sobrecargaFeita", true);
    });
  }
}

/**
 * Botão do teste de mira no card do ataque. Mesma trava do de sobrecarga: o
 * diálogo não é modal, e sem desabilitar o botão dois cliques virariam dois
 * testes para o mesmo tiro.
 */
function prepararBotaoMira(message, element) {
  for (const botao of element.querySelectorAll(".pyro-teste-mira")) {
    if (flagsDe(message)?.miraFeita) {
      botao.disabled = true;
      botao.innerHTML = `<i class="fa-solid fa-check"></i> ${game.i18n.localize("PYRO.Mira.Feito")}`;
      continue;
    }
    botao.addEventListener("click", async () => {
      // A trava vem antes de qualquer espera: dois cliques rápidos abririam
      // dois diálogos para o mesmo tiro, cada um cobrando a Vontade dele.
      botao.disabled = true;
      const liberar = () => { botao.disabled = false; };
      // Pode ser a arma, a técnica ou a magia: o teste é o mesmo, e o item só
      // dá o nome do card e a ficha de quem atira.
      const item = await fromUuid(botao.dataset.itemUuid);
      const actor = await fromUuid(botao.dataset.atorUuid);
      if (!actor?.isOwner) {
        liberar();
        return ui.notifications.warn(game.i18n.localize("PYRO.Uso.SemPermissao"));
      }
      if (!item) {
        liberar();
        return ui.notifications.warn(game.i18n.localize("PYRO.Mira.ItemSumiu"));
      }
      const escrita = Number(botao.dataset.distancia);
      const limite = Number(botao.dataset.limite);
      const alcance = Number(botao.dataset.alcance);
      const feito = await item.rolarMira({
        distancia: Number.isFinite(escrita) && botao.dataset.distancia !== "" ? escrita : null,
        // Sem o dado no botão, quem decide é a criatura (ver rolarMira).
        limite: Number.isFinite(limite) ? limite : null,
        alcance: Number.isFinite(alcance) ? alcance : null
      }).catch(erro => {
        console.error("PYRO | falha no teste de mira", erro);
        return false;
      });
      if (!feito) {
        liberar();
        return;
      }
      await gravarMarca(message, "miraFeita", true);
    });
  }
}

/**
 * Aplica nos alvos um efeito que veio pronto nas flags do card. Diferente do
 * efeito de uso, aqui não existe documento de origem: a regra do elemento
 * montou os dados na hora da conjuração, já com a Intenção daquela vez.
 */
async function aplicarEfeitoDeRegra(message, indice) {
  const dados = flagsDe(message)?.efeitosRegra?.[indice];
  if (!dados) return;

  /*
   * A Defesa de Pedra é do próprio conjurador ("quem conjura recebe"), e não
   * de quem estiver selecionado no momento do clique — quem conjurou está no
   * card, então não há o que escolher.
   */
  const proprio = dados.noConjurador ? conjurador(message) : null;
  const destinos = proprio ? [proprio] : alvos();
  if (!destinos.length) {
    return ui.notifications.warn(game.i18n.localize("PYRO.Avisos.SemAlvoSelecionado"));
  }

  /*
   * Mente não aplica nada sozinha: o mago escolhe quais condições e por quanto
   * tempo, dentro do que a Intenção comprou. A janela cuida disso e dos alvos.
   */
  if (dados.regra === "mental") {
    const { MenteApp } = await import("./apps/mente.mjs");
    return new MenteApp({ alvos: destinos, pontos: dados.valor, dt: dados.dt }).render(true);
  }

  const nomes = [];
  for (const actor of destinos) {
    if (!actor.isOwner) {
      ui.notifications.warn(game.i18n.format("PYRO.Avisos.SemPermissao", { nome: actor.name }));
      continue;
    }
    const feito = await aplicarRegraElemental(actor, dados);
    // Friagem 1 sobre uma Friagem 3 não muda nada: avisar que foi aplicada
    // faria a mesa acreditar num efeito que não existe.
    if (feito !== false) nomes.push(actor.name);
  }
  if (nomes.length) {
    ui.notifications.info(game.i18n.format("PYRO.Efeitos.Aplicado", {
      efeito: dados.name, alvos: nomes.join(", ")
    }));
  } else {
    ui.notifications.info(game.i18n.format("PYRO.Efeitos.SemMudanca", { efeito: dados.name }));
  }
}

/**
 * O que cada regra elemental faz no alvo. Queimando, Molhado e Friagem são
 * condições que empilham; a defesa da pedra é um efeito comum, com prazo, e
 * por isso não passa pela contagem de pilhas.
 */
async function aplicarRegraElemental(actor, dados) {
  const valor = Math.max(0, Math.round(Number(dados.valor) || 0));
  switch (dados.regra) {
    case "queimando": return aplicarQueimando(actor, valor);
    case "molhado": return aplicarMolhado(actor, valor);
    // Friagem não empilha: uma aplicação menor que a atual não muda nada, e
    // é isso que o false diz a quem chamou.
    case "friagem": {
      const antes = pilhasDe(actor, "friagem");
      const r = await aplicarFriagem(actor, valor);
      return !(r && !r.novo && r.pilhas === antes);
    }
    case "defesaTerra":
      /*
       * "Até o fim do próximo turno": dois turnos do próprio, contados pelo
       * relógio — o que passa agora, quando a vez de quem conjurou termina, e
       * o seguinte. O prazo vai na flag porque a duração nativa do Foundry só
       * marca o efeito como vencido, e as mudanças continuariam somando.
       */
      return efeitoComPrazo(actor, {
        name: game.i18n.format("PYRO.Regra.defesaTerra", { valor }),
        img: "icons/svg/shield.svg",
        // A ficha lista este efeito no painel de combate pela chave.
        flags: flagsDoSistema({ regra: "defesaTerra", valor }),
        system: {
          changes: [{ key: "system.defesas.categorias.fisico", type: "add", value: String(valor) }]
        }
      }, 2, true);
  }
}

/**
 * Copia o efeito do item para os atores alvo. Sem token selecionado, cai no
 * personagem do usuário — muitos efeitos de uso são no próprio conjurador.
 * As @variáveis daquele card (alcance, intenção, dano rolado) são resolvidas
 * agora, então a mesma magia conjurada com Intenção 3 entrega um efeito
 * diferente do que ela entregou com Intenção 1.
 */
async function aplicarEfeito(uuid, message = null) {
  const efeito = await fromUuid(uuid);
  if (!efeito) return ui.notifications.warn(game.i18n.localize("PYRO.Efeitos.NaoEncontrado"));

  const destinos = alvos();
  if (!destinos.length) {
    return ui.notifications.warn(game.i18n.localize("PYRO.Avisos.SemAlvoSelecionado"));
  }

  const vars = variaveisDaMensagem(message);
  const nomes = [];
  for (const actor of destinos) {
    if (!actor.isOwner) {
      ui.notifications.warn(game.i18n.format("PYRO.Avisos.SemPermissao", { nome: actor.name }));
      continue;
    }
    await ActiveEffect.implementation.create(
      dadosDoEfeitoAplicado(efeito, vars), { parent: actor }
    );
    nomes.push(actor.name);
  }

  if (nomes.length) {
    ui.notifications.info(game.i18n.format("PYRO.Efeitos.Aplicado", {
      efeito: efeito.name, alvos: nomes.join(", ")
    }));
  }
}
