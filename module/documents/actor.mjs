/**
 * Documento de ator: token inicial, testes de atributo e reação, pagamento
 * de recursos, dano/cura vindos do chat e recuperação por passagem de tempo.
 */
import { PYRO } from "../config.mjs";
import { formulaTeste, formulaReacao, expandirAtributos, poolDoAtributo } from "../dados.mjs";
import { classificarRolagem, poolDoTeste, htmlClasseDaRolagem, flagsDaClasse } from "../progressao.mjs";
import { penalidadeExaustao, dicaExaustao, sincronizarSobrepeso } from "../efeitos.mjs";
import { formularioDoAtor } from "../ui.mjs";
import { htmlFalhaAutomatica, htmlResultadoND } from "../chat.mjs";
import { SYSTEM_ID, flagsDoSistema } from "../sistema.mjs";

/* -------------------------------------------------------------------------- */
/*  Diálogo de teste                                                          */
/* -------------------------------------------------------------------------- */

const campoNumero = (nome, chave, valor = 0, min = null) => `
  <div class="form-group"><label>${game.i18n.localize(chave)}</label>
    <input type="number" name="${nome}" value="${valor}"${min === null ? "" : ` min="${min}"`}></div>`;

const campoCheckbox = (nome, chave, marcado = false) => `
  <div class="form-group"><label>${game.i18n.localize(chave)}</label>
    <input type="checkbox" name="${nome}"${marcado ? " checked" : ""}></div>`;

/**
 * Campos comuns a todo teste (bônus, vantagens, desvantagens, ND), com o
 * aviso de exaustão no topo quando houver.
 * @param {string} [opcoes.dica] linha de contexto antes dos campos.
 * @param {string} [opcoes.extras] campos próprios do teste, no fim.
 */
function camposDeTeste(actor, { dica = "", extras = "" } = {}) {
  const avisoExaustao = dicaExaustao(actor);
  return `
    ${avisoExaustao ? `<p class="hint">${avisoExaustao}</p>` : ""}
    ${dica ? `<p class="hint">${dica}</p>` : ""}
    ${campoNumero("bonus", "PYRO.Teste.Bonus")}
    ${campoNumero("vantagem", "PYRO.Teste.Vantagem", 0, 0)}
    ${campoNumero("desvantagem", "PYRO.Teste.Desvantagem", 0, 0)}
    <div class="form-group"><label>${game.i18n.localize("PYRO.Teste.ND")}</label>
      <input type="number" name="nd" placeholder="—"></div>
    ${extras}`;
}

/** Normaliza os números do formulário e desconta a exaustão do ator (SRD Atributos). */
function aplicarExaustaoNoTeste(actor, opts) {
  const pen = penalidadeExaustao(actor);
  opts.bonus = (Number(opts.bonus) || 0) + pen.bonus;
  opts.vantagem = Number(opts.vantagem) || 0;
  opts.desvantagem = (Number(opts.desvantagem) || 0) + pen.desvantagem;
}

const sufixoND = nd => (nd ? ` (ND ${nd})` : "");

export class PyroActor extends Actor {
  /**
   * Personagens nascem com o token vinculado à ficha: arrastar a ficha pro
   * mapa já traz PV, mana e recursos calculados, e o dano aplicado no token
   * vale pra ficha inteira. NPCs seguem desvinculados, pra cada cópia do
   * mesmo inimigo ter a própria vida.
   */
  async _preCreate(data, options, user) {
    const permitido = await super._preCreate(data, options, user);
    if (permitido === false) return false;
    if (data.prototypeToken?.actorLink !== undefined) return;

    const personagem = this.type === "personagem";
    const escala = PYRO.escalaTamanho(this.system.tamanho, this.system.tamanhoExato);
    this.updateSource({
      prototypeToken: {
        ...PyroActor.formaDoToken(escala),
        // Ficha nova já nasce assinada, então a primeira troca de tamanho
        // dela redesenha o token normalmente.
        flags: flagsDoSistema({ tamanho: this.system.tamanhoExato
          ? `${this.system.tamanho}:${this.system.tamanhoExato}` : this.system.tamanho }),
        actorLink: personagem,
        disposition: personagem
          ? CONST.TOKEN_DISPOSITIONS.FRIENDLY
          : CONST.TOKEN_DISPOSITIONS.HOSTILE,
        sight: { enabled: personagem }
      }
    });
  }

  /*
   * Sobrepeso é derivado (carga contra capacidade), então qualquer coisa
   * pode virá-lo: FOR mudou, item entrou, saiu ou foi equipado, um efeito
   * mexeu na carga. Depois de cada mudança o efeito Exaustão é acertado —
   * só no cliente de quem editou, senão cada um repetiria a conta.
   */
  #acertarSobrepeso(userId) {
    if (game.user.id === userId) sincronizarSobrepeso(this);
  }

  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    this.#acertarSobrepeso(userId);
  }

  _onCreateDescendantDocuments(parent, collection, documents, data, options, userId) {
    super._onCreateDescendantDocuments(parent, collection, documents, data, options, userId);
    this.#acertarSobrepeso(userId);
  }

  _onUpdateDescendantDocuments(parent, collection, documents, changes, options, userId) {
    super._onUpdateDescendantDocuments(parent, collection, documents, changes, options, userId);
    this.#acertarSobrepeso(userId);
  }

  _onDeleteDescendantDocuments(parent, collection, documents, ids, options, userId) {
    super._onDeleteDescendantDocuments(parent, collection, documents, ids, options, userId);
    this.#acertarSobrepeso(userId);
  }

  /**
   * @for, @vig... = valor efetivo (MOD). @dados.for = fórmula da pool
   * (string, inline na Roll — é assim que a iniciativa "@dados.agi" funciona).
   */
  getRollData() {
    const data = { ...super.getRollData() };
    data.dados = {};
    for (const [chave, attr] of Object.entries(this.system.atributos ?? {})) {
      data[chave] = attr.efetivo;
      data.dados[chave] = attr.pool;
    }
    data.det = this.system.det;
    data.multi = this.system.multi;
    return data;
  }

  /**
   * Reage a uma mudança de tamanho da criatura: o token passa a ocupar o
   * espaço novo e o PV acompanha em proporção — quem estava com 3 de 7 vira
   * 6 de 14, e não 3 de 14. Roda pelos hooks de ator, item e efeito, porque
   * o tamanho pode vir de qualquer um dos três.
   *
   * Quem decide se há o que fazer é a marca gravada no prototypeToken, e não
   * a largura dele. A diferença importa: mudar a tabela de tamanhos não sai
   * redesenhando token que ninguém pediu para mudar — quem já estava Enorme
   * continua no desenho antigo até o tamanho mudar de verdade. Ficha que nunca
   * viu a marca adota o estado atual sem mexer em nada.
   */
  async aplicarMudancaDeTamanho() {
    const marca = PyroActor.#marcaDeTamanho(this.system);
    const anterior = this.prototypeToken.getFlag(SYSTEM_ID, "tamanho");
    if (anterior === marca) return;
    // Um cliente só faz a atualização, senão todos disparam a mesma coisa.
    if (!(game.users.activeGM?.isSelf ?? game.user.isGM)) return;

    const mudancas = { [`prototypeToken.flags.${SYSTEM_ID}.tamanho`]: marca };
    const escala = this.system.escalaTamanho;
    const larguraAntiga = this.prototypeToken.width;

    // Primeira vez: só assina o estado de hoje, sem redesenhar nem recalcular.
    if (anterior !== undefined) {
      if (escala !== larguraAntiga) {
        for (const [k, v] of Object.entries(PyroActor.formaDoToken(escala))) {
          mudancas[`prototypeToken.${k}`] = v;
        }
      }
      const razao = PYRO.razaoVida(PyroActor.#tamanhoDaMarca(anterior), this.system.tamanho);
      if (razao !== 1) {
        const pv = this.system.recursos.pv;
        mudancas["system.recursos.pv.value"] = Math.max(0, Math.round(pv.value * razao));
      }
    }

    await this.update(mudancas);
    if (anterior === undefined || escala === larguraAntiga) return;

    // Tokens já postos no mapa: só os que ainda estavam no tamanho anterior,
    // para não desfazer um ajuste manual do mestre.
    for (const cena of game.scenes) {
      const alvos = cena.tokens.filter(t =>
        t.actorId === this.id && t.width === larguraAntiga && t.height === larguraAntiga
      );
      if (alvos.length) {
        await cena.updateEmbeddedDocuments("Token",
          alvos.map(t => ({ _id: t.id, ...PyroActor.formaDoToken(escala) })));
      }
    }
  }

  /**
   * O que o token precisa para ocupar `escala` espaços.
   *
   * Em grid hexagonal o Foundry tem forma própria para token de 2, 3 e 4
   * espaços — a elipse variante 2 é a que esta mesa usa. Acima de 4 só existe
   * o bloco, que já é o padrão, e em grid quadrado a forma é ignorada.
   */
  static formaDoToken(escala) {
    const dados = { width: escala, height: escala };
    const formas = CONST.TOKEN_HEXAGONAL_SHAPES;
    if (!formas) return dados;
    return { ...dados, hexagonalShape: [2, 3, 4].includes(escala) ? formas.ELLIPSE_2 : formas.ELLIPSE_1 };
  }

  /**
   * Assinatura do tamanho, na forma "gigante" ou "colossal:24". O número
   * exato entra porque mudar só ele (colossal 20 para 24) também redesenha
   * o token, sem trocar de degrau.
   */
  static #marcaDeTamanho(sys) {
    return sys.tamanhoExato ? `${sys.tamanho}:${sys.tamanhoExato}` : sys.tamanho;
  }

  /** O degrau de uma marca, ignorando o número exato. */
  static #tamanhoDaMarca(marca) {
    return String(marca ?? "").split(":")[0];
  }

  /* ---------------------------------------------------------------------- */
  /*  Testes de atributo                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Teste de atributo com diálogo (bônus, vantagem/desvantagem, ND,
   * Passar seus Limites). `rapido` pula o diálogo.
   */
  async rolarAtributo(chave, { rapido = false } = {}) {
    const attr = this.system.atributos?.[chave];
    if (!attr) return;
    const label = game.i18n.localize(PYRO.atributos[chave]);

    let opts = { bonus: 0, vantagem: 0, desvantagem: 0, nd: null, passarLimites: false };
    if (!rapido) {
      const extras = attr.acimaDoLimite
        ? campoCheckbox("passarLimites", "PYRO.Teste.PassarLimites") : "";
      const res = await formularioDoAtor(this, {
        titulo: game.i18n.format("PYRO.Teste.Titulo", { atributo: label }),
        conteudo: camposDeTeste(this, { extras })
      });
      if (!res) return;
      opts = { ...opts, ...res, nd: res.nd || null };
    }
    aplicarExaustaoNoTeste(this, opts);

    // Passar seus Limites usa o atributo cheio, sem o desconto do limite de
    // DET. O rebote (1 exaustão por rolagem, SRD Atributos) não é aplicado aqui.
    const valor = opts.passarLimites ? attr.total : attr.efetivo;
    const formula = formulaTeste(valor, opts);
    const flavor = game.i18n.format("PYRO.Chat.TesteDe", { atributo: label }) + sufixoND(opts.nd);
    if (formula === null) return this.#falhaAutomatica(flavor);

    const roll = await new Roll(formula).evaluate();
    let content = "";
    let classe = null;
    if (opts.nd) {
      // A classe mede a pool contra o ND (SRD 3b); o botão de contar chega
      // quando houver uma perícia para receber o uso.
      classe = classificarRolagem({ ...poolDoTeste(poolDoAtributo(valor), opts), nd: Number(opts.nd) });
      content = htmlResultadoND(roll.total >= Number(opts.nd)) + htmlClasseDaRolagem(classe);
    }
    if (opts.passarLimites) {
      content += `<p class="pyro-aviso">${game.i18n.localize("PYRO.Chat.PassouLimites")}</p>`;
    }
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor,
      content: content || undefined,
      ...(classe ? { flags: flagsDoSistema(flagsDaClasse(classe)) } : {})
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Reações                                                               */
  /* ---------------------------------------------------------------------- */

  async rolarEsquiva(opcoes = {}) {
    return this.#rolarReacao("esquiva", opcoes);
  }

  async rolarBloqueio(opcoes = {}) {
    return this.#rolarReacao("bloqueio", opcoes);
  }

  /**
   * Esquiva e bloqueio são testes como os de atributo: mesma janela (bônus
   * fixo, vantagens, desvantagens, ND) mais a cobertura, que dobra os dados
   * (SRD §5), e a mesma exaustão descontando. Shift na ficha pula a janela.
   * Vantagem e desvantagem mexem no dado da reação — d12 na esquiva, d4 no
   * bloqueio — e os dados que o equipamento soma ficam como estão.
   */
  async #rolarReacao(tipo, { cobertura = false, rapido = false } = {}) {
    const cfg = PYRO.reacoes[tipo];
    const chaves = tipo === "esquiva"
      ? { titulo: "PYRO.Esquivar", flavor: "PYRO.Chat.Esquiva", flavorCobertura: "PYRO.Chat.EsquivaCobertura" }
      : { titulo: "PYRO.Bloquear", flavor: "PYRO.Chat.Bloqueio", flavorCobertura: "PYRO.Chat.BloqueioCobertura" };
    let opts = { bonus: 0, vantagem: 0, desvantagem: 0, nd: null, cobertura };

    if (!rapido) {
      const res = await formularioDoAtor(this, {
        titulo: game.i18n.localize(chaves.titulo),
        conteudo: camposDeTeste(this, {
          dica: game.i18n.format("PYRO.Reacao.Base", { formula: this.system[tipo] || "0" }),
          extras: campoCheckbox("cobertura", "PYRO.Reacao.Cobertura", cobertura)
        })
      });
      if (!res) return;
      opts = { ...opts, ...res, nd: res.nd || null, cobertura: !!res.cobertura };
    }
    aplicarExaustaoNoTeste(this, opts);

    const formula = formulaReacao(this.system[tipo], cfg.faces, opts);
    const flavor = game.i18n.localize(opts.cobertura ? chaves.flavorCobertura : chaves.flavor)
      + sufixoND(opts.nd);
    if (formula === null) return this.#falhaAutomatica(flavor);

    const roll = await new Roll(expandirAtributos(formula), this.getRollData()).evaluate();
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor,
      content: opts.nd ? htmlResultadoND(roll.total >= Number(opts.nd)) : undefined
    });
  }

  /** Pool reduzida a zero dados por desvantagem: falha sem rolar (SRD §6). */
  #falhaAutomatica(flavor) {
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor,
      content: htmlFalhaAutomatica()
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Força de Vontade                                                      */
  /* ---------------------------------------------------------------------- */

  async gastarVontade(pontos) {
    const vontade = this.system.recursos.vontade;
    if (vontade.value < pontos) {
      return ui.notifications.warn(game.i18n.localize("PYRO.Avisos.SemVontade"));
    }
    await this.update({ "system.recursos.vontade.value": vontade.value - pontos });
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p><strong>${game.i18n.localize("PYRO.Vontade.Nome")} (${pontos})</strong>:
        ${game.i18n.localize(`PYRO.Vontade.Uso${pontos}`)}</p>`
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Estamina (com transbordo pra PV — SRD Recursos)                       */
  /* ---------------------------------------------------------------------- */

  /** Paga um custo de estamina; o que faltar sai dos PV. Retorna o que foi pago. */
  async pagarEstamina(custo) {
    const recursos = this.system.recursos;
    const daEstamina = Math.min(recursos.estamina.value, custo);
    const dosPv = custo - daEstamina;
    await this.update({
      "system.recursos.estamina.value": recursos.estamina.value - daEstamina,
      "system.recursos.pv.value": Math.max(0, recursos.pv.value - dosPv)
    });
    return { daEstamina, dosPv };
  }

  /**
   * Paga estamina, mana e energia de uma vez (habilidades).
   * Mana e energia não têm transbordo: sem o total, a habilidade não sai.
   * Retorna null se faltar recurso.
   */
  async pagarCustos({ estamina = 0, mana = 0, energia = 0 } = {}) {
    const recursos = this.system.recursos;
    if (mana > recursos.mana.value) {
      ui.notifications.warn(game.i18n.format("PYRO.Avisos.SemMana",
        { custo: mana, mana: recursos.mana.value }));
      return null;
    }
    if (energia > recursos.energia.value) {
      ui.notifications.warn(game.i18n.format("PYRO.Avisos.SemEnergia",
        { custo: energia, energia: recursos.energia.value }));
      return null;
    }

    const daEstamina = Math.min(recursos.estamina.value, estamina);
    const dosPv = estamina - daEstamina;
    await this.update({
      "system.recursos.estamina.value": recursos.estamina.value - daEstamina,
      "system.recursos.pv.value": Math.max(0, recursos.pv.value - dosPv),
      "system.recursos.mana.value": recursos.mana.value - mana,
      "system.recursos.energia.value": recursos.energia.value - energia
    });
    return { daEstamina, dosPv, mana, energia };
  }

  /** Tomar Ar: recupera VIG/2 de estamina, até o máximo. */
  async tomarAr() {
    const estamina = this.system.recursos.estamina;
    const rec = Math.floor(this.system.atributos.vig.efetivo / 2);
    await this.update({
      "system.recursos.estamina.value": Math.min(estamina.max, estamina.value + rec)
    });
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${game.i18n.format("PYRO.Chat.TomarAr", { valor: rec })}</p>`
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Aplicação de dano e cura (menu do chat)                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Aplica dano descontando a defesa de cada tipo separadamente:
   *   (dano1 - defesa1) + (dano2 - defesa2) ...
   * Cada parcela tem piso 0, então uma defesa alta nunca vira cura.
   * Dano de categoria mental consome Mana em vez de PV (SRD §6).
   *
   * @param {Array<{tipo: string, total: number}>} entradas
   * @param {object} [opcoes]
   * @param {number} [opcoes.multiplicador]  metade (0.5), dobro (2)...
   * @param {boolean} [opcoes.ignorarDefesa] força o valor cheio
   * @param {boolean} [opcoes.mental]        trata tudo como mental
   * @returns {Promise<string>} resumo com a conta feita
   */
  async aplicarDano(entradas, { multiplicador = 1, ignorarDefesa = false, mental = false } = {}) {
    const recursos = this.system.recursos;
    const totais = this.system.defesas.totais;
    let emPv = 0;
    let emMana = 0;
    const contas = [];

    for (const entrada of entradas) {
      const tipo = mental ? "mental" : entrada.tipo;
      const bruto = Math.floor(entrada.total * multiplicador);
      // Sem tipo conhecido (rolagem avulsa no chat) não há defesa a aplicar.
      const defesa = ignorarDefesa || !tipo ? 0 : (totais[tipo] ?? 0);
      const liquido = Math.max(0, bruto - defesa);

      if (PYRO.tiposDano[tipo]?.categoria === "mental") emMana += liquido;
      else emPv += liquido;

      const rotulo = tipo ? game.i18n.localize(PYRO.tiposDano[tipo]?.label ?? tipo) : "";
      contas.push(defesa
        ? `${rotulo} ${bruto}-${defesa}=${liquido}`
        : `${rotulo} ${liquido}`.trim());
    }

    const pvNovo = Math.max(0, recursos.pv.value - emPv);
    const manaNovo = Math.max(0, recursos.mana.value - emMana);
    await this.update({
      "system.recursos.pv.value": pvNovo,
      "system.recursos.mana.value": manaNovo
    });

    const partes = [];
    if (emPv) partes.push(game.i18n.format("PYRO.Chat.AplicouDano", { valor: emPv, pv: pvNovo }));
    if (emMana) partes.push(game.i18n.format("PYRO.Chat.AplicouMental", { valor: emMana }));
    if (!partes.length) partes.push(game.i18n.localize("PYRO.Chat.DefesaAbsorveu"));

    return `${this.name}: ${partes.join(" · ")} (${contas.join(" + ")})`;
  }

  /** Cura PV até o máximo. */
  async aplicarCura(valor) {
    const pv = this.system.recursos.pv;
    const novo = Math.min(pv.max, pv.value + Math.max(0, Math.floor(valor)));
    await this.update({ "system.recursos.pv.value": novo });
    return `${this.name}: ${game.i18n.format("PYRO.Chat.AplicouCura", { valor: novo - pv.value, pv: novo })}`;
  }

  /** Devolve estamina (efeitos de fôlego, itens). */
  async aplicarEstamina(valor) {
    const estamina = this.system.recursos.estamina;
    const novo = Math.clamp(estamina.value + Math.floor(valor), 0, estamina.max);
    await this.update({ "system.recursos.estamina.value": novo });
    return `${this.name}: ${game.i18n.format("PYRO.Chat.AplicouEstamina", { valor: novo - estamina.value })}`;
  }

  /* ---------------------------------------------------------------------- */
  /*  Recuperação por passagem de tempo                                     */
  /* ---------------------------------------------------------------------- */

  /** Recursos personalizados que este personagem tem acesso. */
  #recursosExtras() {
    return (this.system.recursosConcedidos ?? []).filter(c => this.system.recursos[c]);
  }

  /** Início de cena: estamina cheia, +VIG de PV, +recuperação de mana. */
  async recuperarCena() {
    const recursos = this.system.recursos;
    const vig = this.system.atributos.vig.efetivo;
    const extras = {};
    for (const chave of this.#recursosExtras()) {
      const rec = recursos[chave];
      extras[`system.recursos.${chave}.value`] =
        Math.min(rec.max, rec.value + (rec.recuperacao ?? 0));
    }
    await this.update({
      ...extras,
      "system.recursos.estamina.value": recursos.estamina.max,
      "system.recursos.pv.value": Math.min(recursos.pv.max, recursos.pv.value + vig),
      "system.recursos.mana.value":
        Math.min(recursos.mana.max, recursos.mana.value + recursos.mana.recuperacao),
      "system.recursos.energia.value":
        Math.min(recursos.energia.max, recursos.energia.value + recursos.energia.recuperacao)
    });
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${game.i18n.localize("PYRO.Chat.NovaCena")}</p>`
    });
  }

  /** Início de capítulo: vida e mana completas. */
  async recuperarCapitulo() {
    const recursos = this.system.recursos;
    const extras = {};
    for (const chave of this.#recursosExtras()) {
      extras[`system.recursos.${chave}.value`] = recursos[chave].max;
    }
    await this.update({
      ...extras,
      "system.recursos.pv.value": recursos.pv.max,
      "system.recursos.mana.value": recursos.mana.max,
      "system.recursos.energia.value": recursos.energia.max,
      "system.recursos.estamina.value": recursos.estamina.max
    });
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${game.i18n.localize("PYRO.Chat.NovoCapitulo")}</p>`
    });
  }

  /** Início de arco (ou subida de DET): Força de Vontade reseta. */
  async recuperarArco() {
    await this.recuperarCapitulo();
    await this.update({
      "system.recursos.vontade.value": this.system.recursos.vontade.max
    });
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${game.i18n.localize("PYRO.Chat.NovoArco")}</p>`
    });
  }
}
