/**
 * Documento de ator: token inicial, testes de atributo e reação, pagamento
 * de recursos, dano/cura vindos do chat e recuperação por passagem de tempo.
 */
import { PYRO } from "../config.mjs";
import { formulaTeste, formulaReacao, expandirAtributos, poolDoAtributo } from "../dados.mjs";
import {
  classificarRolagem, poolDoTeste, htmlClasseDaRolagem, flagsDaClasse, bonusPorNivel, ndAjustado
} from "../progressao.mjs";
import {
  sincronizarSobrepeso, sincronizarDesmaio, sincronizarEstadoDeVida, aplicarExaustao
} from "../efeitos.mjs";
import { formularioDoAtor } from "../ui.mjs";
import {
  campoCheckbox, campoSelect, camposDeTeste, aplicarExaustaoNoTeste, aplicarVontadeNoTeste,
  valorComInspiracao, htmlVontadeGasta, vontadeDisponivel, sufixoND
} from "../teste.mjs";
import { htmlFalhaAutomatica, htmlResultadoND, htmlBotaoSorte } from "../chat.mjs";
import { SYSTEM_ID, flagsDoSistema } from "../sistema.mjs";

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
   * Sobrepeso e desmaio por exaustão são derivados — o primeiro da carga
   * contra a capacidade, o segundo da exaustão contra o VIG —, e quase
   * qualquer mudança pode virá-los: FOR ou VIG mudou, item entrou, saiu ou
   * foi equipado, um efeito mexeu na carga ou na exaustão. Depois de cada
   * mudança os dois são acertados, só no cliente de quem editou, senão cada
   * um repetiria a conta.
   *
   * O sobrepeso vem primeiro porque ele mesmo soma exaustão, e é essa
   * exaustão que o desmaio precisa enxergar.
   */
  async #acertarDerivados(userId) {
    if (game.user.id !== userId) return;
    /*
     * Uma sincronização por vez, em fila. Os hooks que chamam esta função são
     * síncronos e ela cria efeitos, o que dispara os mesmos hooks antes do
     * `create` de fora terminar: sem a fila, duas execuções conferem "já
     * existe?" ao mesmo tempo, as duas veem que não, e o personagem fica com
     * dois Machucados. A fila é por ator, e o `catch` existe para um erro numa
     * passagem não travar todas as seguintes.
     */
    this.#filaDerivados = this.#filaDerivados
      .catch(() => {})
      .then(async () => {
        await sincronizarSobrepeso(this);
        await sincronizarDesmaio(this);
        await sincronizarEstadoDeVida(this);
      });
    return this.#filaDerivados;
  }

  #filaDerivados = Promise.resolve();

  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    this.#acertarDerivados(userId);
  }

  _onCreateDescendantDocuments(parent, collection, documents, data, options, userId) {
    super._onCreateDescendantDocuments(parent, collection, documents, data, options, userId);
    this.#acertarDerivados(userId);
  }

  _onUpdateDescendantDocuments(parent, collection, documents, changes, options, userId) {
    super._onUpdateDescendantDocuments(parent, collection, documents, changes, options, userId);
    this.#acertarDerivados(userId);
  }

  _onDeleteDescendantDocuments(parent, collection, documents, ids, options, userId) {
    super._onDeleteDescendantDocuments(parent, collection, documents, ids, options, userId);
    this.#acertarDerivados(userId);
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

    /*
     * Passar seus Limites usa o atributo cheio, sem o desconto do limite de
     * DET. O rebote vem depois: 1 exaustão por rolagem feita assim (SRD
     * Atributos), inclusive quando a pool zera e o teste falha sozinho — o
     * corpo foi forçado do mesmo jeito.
     */
    const valorBase = opts.passarLimites ? attr.total : attr.efetivo;

    /*
     * A classe da rolagem é medida antes da Força de Vontade entrar: por
     * regra ela fica fora dessa conta (SRD 3b), senão gastar pontos num teste
     * o rebaixaria de difícil para rotineiro e ele deixaria de contar para o
     * avanço — exatamente ao contrário do que o gasto significa.
     */
    const classe = opts.nd
      ? classificarRolagem({ ...poolDoTeste(poolDoAtributo(valorBase), opts), nd: Number(opts.nd) })
      : null;

    const vontade = await aplicarVontadeNoTeste(this, opts);
    opts.vantagem += vontade.beneficio;
    const valor = valorComInspiracao(valorBase, vontade);
    const formula = formulaTeste(valor, opts);
    const flavor = game.i18n.format("PYRO.Chat.TesteDe", { atributo: label }) + sufixoND(opts.nd);
    const rebote = opts.passarLimites ? await aplicarExaustao(this, 1) : 0;
    const extra = htmlVontadeGasta(vontade) + this.#avisoLimites(opts, rebote);
    if (formula === null) return this.#falhaAutomatica(flavor, extra);

    const roll = await new Roll(formula).evaluate();
    let content = "";
    if (classe) {
      content = htmlResultadoND(roll.total >= Number(opts.nd)) + htmlClasseDaRolagem(classe);
    }
    content += extra;
    return this.#cardDeTeste(roll, { flavor, html: content, flags: classe ? flagsDaClasse(classe) : null });
  }


  /* ---------------------------------------------------------------------- */
  /*  Perícias                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Teste de perícia (SRD 3b): o jogador escolhe o atributo entre os que a
   * perícia aceita; o nível soma +1 e +1 vantagem a cada 5; sem treino e sem
   * ferramentas o ND acima de 10 dobra. A classe da rolagem é medida contra o
   * ND original, com a pool já com os bônus da perícia.
   * @param {Item} pericia
   * @param {object} [opcoes]
   * @param {boolean} [opcoes.ajudar] só calcula a ajuda a um aliado, sem rolar.
   */
  async rolarPericia(pericia, { ajudar = false } = {}) {
    const sys = pericia.system;
    const nivel = sys.progresso.nivel;
    const porNivel = bonusPorNivel(nivel);
    const loc = k => game.i18n.localize(k);

    const aceitos = sys.atributos.length ? sys.atributos : Object.keys(PYRO.atributos);
    const atributoOpts = Object.fromEntries(aceitos.map(k => [k, loc(PYRO.atributos[k])]));
    const dicaNivel = nivel
      ? game.i18n.format("PYRO.Pericia.DicaNivel", { nivel, bonus: porNivel.bonus, vantagens: porNivel.vantagens })
      : loc("PYRO.Pericia.DicaSemTreino");
    const extras = sys.exigeFerramentas ? campoCheckbox("semFerramentas", "PYRO.Pericia.SemFerramentas") : "";

    const res = await formularioDoAtor(this, {
      titulo: game.i18n.format(ajudar ? "PYRO.Pericia.TituloAjuda" : "PYRO.Pericia.Titulo", { nome: pericia.name }),
      // Ajudar não rola nada: sem campos de Força de Vontade, que ali não
      // teriam onde ser gastos.
      conteudo: campoSelect("atributo", "PYRO.Pericia.Atributo", atributoOpts, aceitos[0])
        + camposDeTeste(this, { dica: dicaNivel, extras, comVontade: !ajudar }),
      rotuloOk: ajudar ? "PYRO.Pericia.Ajudar" : "PYRO.Rolar"
    });
    if (!res) return;

    const chave = atributoOpts[res.atributo] ? res.atributo : aceitos[0];
    const attr = this.system.atributos[chave];
    const opts = { bonus: res.bonus, vantagem: res.vantagem, desvantagem: res.desvantagem };
    aplicarExaustaoNoTeste(this, opts);
    opts.bonus += porNivel.bonus;
    opts.vantagem += porNivel.vantagens;

    const ndOriginal = Number(res.nd) || 0;
    const semFerramentas = sys.exigeFerramentas && !!res.semFerramentas;
    const nd = ndAjustado(ndOriginal, { semTreino: !sys.aprendida, semFerramentas });
    const classe = ndOriginal
      ? classificarRolagem({ ...poolDoTeste(poolDoAtributo(attr.efetivo), opts), nd: ndOriginal })
      : null;
    const rotuloAtributo = loc(PYRO.atributos[chave]);
    const ajustes = [
      !sys.aprendida ? loc("PYRO.Pericia.SemTreinoTag") : null,
      semFerramentas ? loc("PYRO.Pericia.SemFerramentasTag") : null
    ].filter(Boolean).join(", ");
    const textoND = !ndOriginal ? ""
      : nd !== ndOriginal ? ` (ND ${ndOriginal} → ${nd}, ${ajustes})` : ` (ND ${nd})`;

    // Ajudar não rola nada, então também não gasta Força de Vontade.
    if (ajudar) return this.#cardDeAjuda(pericia, rotuloAtributo, porNivel, classe, textoND);

    // Depois da classe, pelo mesmo motivo do teste de atributo: a Vontade
    // não entra na medida de dificuldade da rolagem.
    const vontade = await aplicarVontadeNoTeste(this, res);
    opts.vantagem += vontade.beneficio;

    const flavor = game.i18n.format("PYRO.Pericia.TesteDe", { nome: pericia.name, atributo: rotuloAtributo }) + textoND;
    const formula = formulaTeste(valorComInspiracao(attr.efetivo, vontade), opts);
    if (formula === null) return this.#falhaAutomatica(flavor, htmlVontadeGasta(vontade));

    const roll = await new Roll(formula).evaluate();
    let content = "";
    if (ndOriginal) {
      const sucesso = roll.total >= nd;
      // Percepção só progride com sucesso: sem ele, a classe aparece mas o botão não.
      const conta = !sys.contaSoSucesso || sucesso;
      content = htmlResultadoND(sucesso) + htmlClasseDaRolagem(classe, conta ? pericia : null);
    }
    content += htmlVontadeGasta(vontade);
    return this.#cardDeTeste(roll, { flavor, html: content, flags: classe ? flagsDaClasse(classe, pericia) : null });
  }

  /**
   * Ajudar (SRD §5): 1 vantagem ao aliado, mais 1 a cada 5 níveis da perícia.
   * O ajudante progride como se tivesse rolado, então o card traz a classe
   * da pool dele contra o ND e o botão de contar.
   */
  #cardDeAjuda(pericia, rotuloAtributo, porNivel, classe, textoND) {
    const vantagens = 1 + porNivel.vantagens;
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: game.i18n.format("PYRO.Pericia.AjudaCom", { nome: pericia.name, atributo: rotuloAtributo }) + textoND,
      content: `<div class="pyro-chat">
        <p class="pyro-ajuda">${game.i18n.format("PYRO.Pericia.AjudaTexto", { vantagens })}</p>
        ${htmlClasseDaRolagem(classe, pericia)}
      </div>`,
      ...(classe ? { flags: flagsDoSistema(flagsDaClasse(classe, pericia)) } : {})
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
        // Sem Inspiração Divina: a pool da reação é fixa pelo sistema (d4 no
        // bloqueio, d12 na esquiva) e não sai de atributo nenhum, então não há
        // atributo para dobrar.
        conteudo: camposDeTeste(this, {
          dica: game.i18n.format("PYRO.Reacao.Base", { formula: this.system[tipo] || "0" }),
          extras: campoCheckbox("cobertura", "PYRO.Reacao.Cobertura", cobertura),
          comInspiracao: false
        })
      });
      if (!res) return;
      opts = { ...opts, ...res, nd: res.nd || null, cobertura: !!res.cobertura };
    }
    aplicarExaustaoNoTeste(this, opts);
    const vontade = await aplicarVontadeNoTeste(this, opts);
    opts.vantagem += vontade.beneficio;

    const formula = formulaReacao(this.system[tipo], cfg.faces, opts);
    const flavor = game.i18n.localize(opts.cobertura ? chaves.flavorCobertura : chaves.flavor)
      + sufixoND(opts.nd);
    if (formula === null) return this.#falhaAutomatica(flavor, htmlVontadeGasta(vontade));

    const roll = await new Roll(expandirAtributos(formula), this.getRollData()).evaluate();
    return this.#cardDeTeste(roll, {
      flavor,
      html: (opts.nd ? htmlResultadoND(roll.total >= Number(opts.nd)) : "") + htmlVontadeGasta(vontade)
    });
  }

  /**
   * Card de um teste: a rolagem renderizada e, abaixo dela, o resultado contra
   * o ND e a classe. Monta o conteúdo à mão porque `content` em toMessage
   * substituiria a rolagem em vez de acompanhá-la.
   */
  async #cardDeTeste(roll, { flavor, html = "", flags = null }) {
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor,
      // A Sorte age sobre esta rolagem, então o botão dela mora no card.
      content: `<div class="pyro-chat pyro-teste">${await roll.render()}${html}${htmlBotaoSorte()}</div>`,
      rolls: [roll],
      sound: CONFIG.sounds.dice,
      ...(flags ? { flags: flagsDoSistema(flags) } : {})
    });
  }

  /** Pool reduzida a zero dados por desvantagem: falha sem rolar (SRD §6). */
  #falhaAutomatica(flavor, html = "") {
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor,
      content: htmlFalhaAutomatica() + html
    });
  }

  /**
   * Linha do card quando o teste passou dos limites do corpo: diz que o
   * atributo cheio foi usado e quanta exaustão isso custou (SRD Atributos).
   */
  #avisoLimites(opts, total) {
    if (!opts.passarLimites) return "";
    return `<p class="pyro-aviso">${game.i18n.localize("PYRO.Chat.PassouLimites")}
      ${game.i18n.format("PYRO.Chat.ReboteLimites", { total })}</p>`;
  }

  /* ---------------------------------------------------------------------- */
  /*  Força de Vontade                                                      */
  /* ---------------------------------------------------------------------- */

  /**
   * Vontade de Viver (SRD Atributos): a 0 PV, por 2 pontos, o personagem se
   * agarra à própria vida e não cai. Recupera o suficiente para deixar de
   * estar Machucado, que é o limiar de um quarto da vida máxima — nem mais
   * que isso, porque a regra é sobreviver, não voltar inteiro.
   */
  async vontadeDeViver() {
    const recursos = this.system.recursos;
    if (recursos.pv.value > 0) {
      return ui.notifications.warn(game.i18n.localize("PYRO.Vontade.ViverSoAZero"));
    }
    if (recursos.vontade.value < PYRO.CUSTO_VONTADE_DE_VIVER) {
      return ui.notifications.warn(game.i18n.localize("PYRO.Avisos.SemVontade"));
    }
    const alvo = this.system.limiaresPv.machucado;
    await this.update({
      "system.recursos.vontade.value": recursos.vontade.value - PYRO.CUSTO_VONTADE_DE_VIVER,
      "system.recursos.pv.value": alvo
    });
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<div class="pyro-chat"><p class="pyro-vontade-viver">
        <strong>${game.i18n.localize("PYRO.Vontade.Viver")}</strong>
        ${game.i18n.format("PYRO.Vontade.ViverCard", { pv: alvo })}</p></div>`
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

  /* ---------------------------------------------------------------------- */
  /*  Posturas (SRD Técnicas)                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Postura ativa, ou null. A escolha é uma flag do ator e não um campo da
   * habilidade: só uma vale por vez, e guardá-la no ator torna impossível
   * ficar com duas ligadas.
   */
  get posturaAtiva() {
    const id = this.getFlag(SYSTEM_ID, "postura");
    const item = id ? this.items.get(id) : null;
    return item?.system?.ehPostura ? item : null;
  }

  /**
   * Entra numa postura, ou sai dela ao repetir a que já está ativa. Custa 1
   * ação em combate (SRD Técnicas); o card serve de aviso à mesa, o gasto da
   * ação continua na contagem do turno.
   */
  async alternarPostura(item) {
    if (item && !item.system?.ehPostura) return;
    const saindo = !item || this.posturaAtiva?.id === item.id;
    await this.setFlag(SYSTEM_ID, "postura", saindo ? "" : item.id);
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p class="pyro-postura">${saindo
        ? game.i18n.localize("PYRO.Postura.Saiu")
        : game.i18n.format("PYRO.Postura.Entrou", { nome: Handlebars.escapeExpression(item.name) })}</p>`
    });
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
  async aplicarDano(entradas, {
    multiplicador = 1, ignorarDefesa = false, mental = false, recursoMental = "mana"
  } = {}) {
    const recursos = this.system.recursos;
    const totais = this.system.defesas.totais;
    /*
     * O recurso vem declarado no golpe. Um recurso próprio de caminho (Energia
     * Natural e afins) existe no schema de todo ator, mas só vale para quem o
     * caminho concedeu — testar a existência do campo faria o dano sumir numa
     * barra invisível. Sem o recurso concedido, o dano cai na mana, que é de
     * todos.
     */
    const proprio = PYRO.recursosCustom?.[recursoMental];
    const temRecurso = !!recursos[recursoMental]
      && (!proprio || (this.system.recursosConcedidos ?? []).includes(recursoMental));
    const chaveRecurso = temRecurso ? recursoMental : "mana";
    let emPv = 0;
    let emRecurso = 0;
    const contas = [];

    for (const entrada of entradas) {
      const tipo = mental ? "mental" : entrada.tipo;
      const bruto = Math.floor(entrada.total * multiplicador);
      // Sem tipo conhecido (rolagem avulsa no chat) não há defesa a aplicar.
      const defesa = ignorarDefesa || !tipo ? 0 : (totais[tipo] ?? 0);
      const liquido = Math.max(0, bruto - defesa);

      if (PYRO.tiposDano[tipo]?.categoria === "mental") emRecurso += liquido;
      else emPv += liquido;

      const rotulo = tipo ? game.i18n.localize(PYRO.tiposDano[tipo]?.label ?? tipo) : "";
      contas.push(defesa
        ? `${rotulo} ${bruto}-${defesa}=${liquido}`
        : `${rotulo} ${liquido}`.trim());
    }

    const pvNovo = Math.max(0, recursos.pv.value - emPv);
    const recursoNovo = Math.max(0, recursos[chaveRecurso].value - emRecurso);
    await this.update({
      "system.recursos.pv.value": pvNovo,
      [`system.recursos.${chaveRecurso}.value`]: recursoNovo
    });

    const partes = [];
    if (emPv) partes.push(game.i18n.format("PYRO.Chat.AplicouDano", { valor: emPv, pv: pvNovo }));
    if (emRecurso) {
      partes.push(game.i18n.format("PYRO.Chat.AplicouMental", {
        valor: emRecurso,
        recurso: game.i18n.localize(PYRO.recursosDrenaveis()[chaveRecurso] ?? chaveRecurso)
      }));
    }
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

  /**
   * Início de arco: tudo que o capítulo recupera.
   *
   * A Força de Vontade fica de fora de propósito. Ela não volta com o tempo
   * (SRD Atributos): todo ponto é conquistado em jogo — por um instinto que
   * criou problema, por uma crença defendida, por votação no fim do arco —, e
   * enchê-la aqui tornaria o resto dessa economia decorativa.
   */
  async recuperarArco() {
    await this.recuperarCapitulo();
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${game.i18n.localize("PYRO.Chat.NovoArco")}</p>`
    });
  }
}
