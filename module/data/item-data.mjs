/**
 * Data models dos itens (arma, equipamento, consumível, habilidade, técnica,
 * feitiço, runa, magia, caminho) e a contabilidade de XP das habilidades por
 * Caminho.
 */
import { PYRO } from "../config.mjs";
import { pontosDaTecnica } from "../tecnica.mjs";
import { num, dec, str, nivelPorUso } from "./campos.mjs";

const fields = foundry.data.fields;

class BaseItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return { descricao: new fields.HTMLField() };
  }
}

/* ---------------------- Vínculo habilidade <-> caminho --------------------- */

/**
 * A regra de progressão que vale, entre as habilidades do personagem que o
 * filtro aceita.
 *
 * Quando mais de uma habilidade dispara regras diferentes, vale a que vem
 * antes na lista de configuração, e não a que estiver antes na ficha: a ordem
 * dos itens muda com arraste e criação, a da lista o mestre controla.
 */
function melhorProgressao(actor, aceita) {
  const indice = PYRO.progressaoPorNome;
  if (!actor || !indice?.size) return null;

  let escolhida = null;
  for (const item of actor.items) {
    if (item.type !== "habilidade") continue;
    const regra = indice.get(PYRO.normalizarTexto(item.name));
    if (!regra || !aceita(regra, item)) continue;
    if (regra.posicao === 0) return regra;
    if (!escolhida || regra.posicao < escolhida.posicao) escolhida = regra;
  }
  return escolhida;
}

/**
 * Curva de um Caminho: qual regra de progressão ele está usando.
 *
 * A regra é disparada pelo nome de uma habilidade, e a varredura inclui a
 * habilidade base de propósito: é ela que costuma carregar o traço do Caminho.
 * Regra presa ao Caminho só vale para o Caminho da própria habilidade; regra
 * solta vale para todos os Caminhos do personagem, venha ela de onde vier.
 *
 * Quando nada bate, vale o custo cheio do ranque.
 */
export function progressaoDoCaminho(actor, caminho) {
  return melhorProgressao(actor, (regra, item) =>
    !regra.soDoCaminho || (!!caminho && item.system.caminho === caminho))
    ?? PYRO.progressaoPadrao;
}

/**
 * A regra solta que o personagem carrega — a que não está presa ao Caminho de
 * origem. É ela que barateia um Caminho novo, que não pertence a Caminho
 * nenhum e por isso não teria regra de onde puxar.
 */
export function progressaoGlobal(actor) {
  return melhorProgressao(actor, regra => !regra.soDoCaminho) ?? PYRO.progressaoPadrao;
}

/**
 * Custo de um Caminho novo já com a regra solta do personagem (SRD §2).
 * @param {number} quantos Caminhos que ele já tem.
 */
export function custoDeCaminhoNovo(actor, quantos) {
  const base = PYRO.custoDoCaminhoNovo(quantos);
  const mult = Number(progressaoGlobal(actor).multiplicador);
  return Math.ceil(base * (Number.isFinite(mult) ? mult : 1));
}

/**
 * Como um Caminho calcula um recurso que ele concede: a fórmula escrita nele,
 * ou a padrão do mundo enquanto ninguém a reescreveu, e a habilidade que dá o
 * nível para a fórmula.
 */
export function configDoRecurso(caminho, chave) {
  const gravado = (caminho?.system?.recursosConfig ?? []).find(r => r.chave === chave);
  const padrao = PYRO.recursosCustom?.[chave]?.formula
    ?? PYRO.formulasRecursoBase?.[chave] ?? "";
  return {
    formula: gravado?.formula?.trim() || padrao,
    habilidadeId: gravado?.habilidadeId ?? "",
    // A fórmula é a do mundo, ou esta ficha reescreveu a dela?
    propria: !!gravado?.formula?.trim()
  };
}

/** Nível que alimenta [NVL] na fórmula de um recurso: o da habilidade escolhida. */
export function nivelDoRecurso(actor, caminho, chave) {
  const { habilidadeId } = configDoRecurso(caminho, chave);
  if (!habilidadeId) return 0;
  const habilidade = actor?.items?.get(habilidadeId);
  return Number(habilidade?.system?.nivel) || 0;
}

/**
 * Custo em XP de uma habilidade (SRD §3): o custo do ranque na curva do mundo,
 * vezes o multiplicador da regra do Caminho. A habilidade base vem junto do
 * Caminho e não custa nada.
 */
export function custoDaHabilidade(sys, progressao = null) {
  if (sys?.ehBase) return 0;
  return PYRO.custoDoRanque(sys?.ranque ?? 1, progressao?.multiplicador ?? 1);
}

/* ---------------------------- Arma ---------------------------------------- */

export class ArmaData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      // Cada entrada é uma rolagem de dano com seu tipo. Aceita atributos
      // como bônus: "2d8 + @des" (ver Actor#getRollData).
      danos: new fields.ArrayField(new fields.SchemaField({
        formula: str("2d6"),
        tipo: str("impacto")
      }), { initial: [{ formula: "2d6", tipo: "impacto" }] }),
      usaMunicao: new fields.BooleanField({ initial: false }),
      /*
       * Ataque desarmado: soco, chute, mordida. É uma arma como as outras na
       * ficha — a marca existe para as técnicas poderem exigir "só desarmado"
       * na especificidade, sem o sistema ter que adivinhar pelo nome.
       */
      desarmado: new fields.BooleanField({ initial: false }),
      /*
       * Qual recurso o dano mental desta arma drena (SRD §6). Fica aqui, e não
       * na hora de aplicar no chat, porque é característica do golpe: uma lâmina
       * que suga fôlego suga fôlego de quem quer que ela acerte.
       * Sem choices: os recursos próprios do mundo são configuráveis.
       */
      recursoMental: str("mana"),
      /*
       * Tamanho da arma, não de quem a empunha: uma clava de gigante continua
       * sendo de gigante na mão de quem a roubou. Médio é o padrão e vale ×1,
       * então arma antiga e item de compêndio nascem sem multiplicador — é
       * característica a mais, não regra nova para todo mundo.
       */
      tamanho: str("medio", { choices: Object.keys(PYRO.tamanhos) }),
      acoes: num(2, { min: 1 }),
      maos: num(1, { min: 1, max: 2 }),
      // Alcance menor: até aqui o tiro é normal. Além dele, e até o máximo,
      // o teste de mira recebe desvantagem (SRD §5). 0 = corpo a corpo.
      alcanceMenor: num(0, { min: 0 }),
      alcanceMaximo: num(0, { min: 0 }),
      peso: num(0, { min: 0 }),
      custo: num(0, { min: 0 }),
      quantidade: num(1, { min: 0 })
    };
  }
}

/* ---------------------------- Equipamento ---------------------------------- */

export class EquipamentoData extends BaseItemData {
  static defineSchema() {
    const tipos = Object.keys(PYRO.tiposDano).reduce((acc, t) => {
      acc[t] = num(0);
      return acc;
    }, {});
    return {
      ...super.defineSchema(),
      // Sabor do equipamento: separa a lista do inventário e libera os campos
      // próprios de mochila e de item arcano.
      categoria: str("equipamento", { choices: Object.keys(PYRO.categoriasEquipamento) }),
      parte: str("peitoral", { choices: Object.keys(PYRO.partesCorpo) }),
      equipado: new fields.BooleanField({ initial: false }),
      // Mochila: soma na capacidade de carga enquanto equipada.
      cargaBonus: num(0, { min: 0 }),
      // Item arcano: abate mana de tudo que gasta mana, enquanto equipado.
      reducaoMana: num(0, { min: 0 }),
      // Bônus de defesa por categoria E por tipo específico.
      defesas: new fields.SchemaField({
        categorias: new fields.SchemaField({
          fisico: num(0), energetico: num(0), mental: num(0)
        }),
        tipos: new fields.SchemaField(tipos)
      }),
      // Dados extras somados às reações: "1d4" no bloqueio, "1d12" na esquiva.
      bloqueio: str(""),
      esquiva: str(""),
      /*
       * Pilha: o peso escrito vale uma vez só, seja qual for a quantidade —
       * um molho de chaves, um cinto de frascos, uma aljava. É a mesma ideia
       * da munição, aberta para qualquer item que a mesa queira tratar como
       * um volume só.
       */
      pilha: new fields.BooleanField({ initial: false }),
      peso: num(0, { min: 0 }),
      custo: num(0, { min: 0 }),
      quantidade: num(1, { min: 0 })
    };
  }
}

/* ---------------------------- Consumível ----------------------------------- */

export class ConsumivelData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      acoes: num(2, { min: 0 }),
      formula: str(""), // ex: "2d8" (cura) ou dano da munição ("2d10")
      municao: new fields.BooleanField({ initial: false }),
      tipoDano: str("perfurante"), // usado quando é munição
      // Munição pode ser presa nas costas ou na cintura.
      equipado: new fields.BooleanField({ initial: false }),
      parte: str("cintura"),
      /*
       * Pilha: o peso escrito vale uma vez só, seja qual for a quantidade —
       * um molho de chaves, um cinto de frascos, uma aljava. É a mesma ideia
       * da munição, aberta para qualquer item que a mesa queira tratar como
       * um volume só.
       */
      pilha: new fields.BooleanField({ initial: false }),
      peso: num(0, { min: 0 }),
      custo: num(0, { min: 0 }),
      quantidade: num(1, { min: 0 })
    };
  }
}

/* ---------------------------- Habilidade ----------------------------------- */

/** Habilidades de Caminho, gerais e técnicas marciais. */
export class HabilidadeData extends BaseItemData {
  /**
   * Postura (SRD Técnicas): a habilidade base de um caminho marcial. Os
   * efeitos dela só valem enquanto ela é a postura ativa, e cada técnica pode
   * escrever uma variação para ela. É a categoria que diz, e não um campo à
   * parte — uma habilidade não é passiva e postura ao mesmo tempo.
   */
  get ehPostura() {
    return this.categoria === "postura";
  }

  /**
   * Transformação: uma forma em que o personagem entra por vontade própria e
   * que acaba sozinha quando o prazo vence. Como a postura, os efeitos dela só
   * valem enquanto ela está ativa; diferente da postura, ela é cobrada como um
   * uso, tem duração e não é lembrada no começo do combate — quem transforma
   * escolhe a hora.
   */
  get ehTransformacao() {
    return this.categoria === "transformacao";
  }

  static defineSchema() {
    return {
      ...super.defineSchema(),
      caminho: str(""), // id do Caminho de origem ("geral" para habilidades gerais)
      // Passiva, ativável, postura ou transformação — organiza a lista da ficha
      // e, nas duas últimas, decide quando os efeitos da habilidade valem.
      categoria: str("ativavel", { choices: Object.keys(PYRO.categoriasHabilidade) }),
      /*
       * Quanto tempo a transformação dura. O valor é texto porque aceita
       * fórmula ("@nvl", "@nvl * 2"): a forma costuma esticar conforme a
       * habilidade sobe, e um número fixo obrigaria a reescrever a cada nível.
       * Vazio ou zero é forma sem prazo — ela só acaba quando o jogador sai.
       */
      duracao: new fields.SchemaField({
        valor: str(""),
        unidade: str("turnos", { choices: Object.keys(PYRO.unidadesDeDuracao) })
      }),
      /*
       * O preço de voltar ao normal, um recurso por linha:
       * { mana: { modo: "zerar", valor: "" }, estamina: { modo: "gastar", valor: "@nvl" } }.
       * O que o personagem não tiver não vira dívida — cobra-se o que há.
       *
       * A exaustão e as outras marcas do fim não moram aqui: elas são efeitos
       * marcados como "ao acabar" na aba de Efeitos, escritos no mesmo
       * construtor de todos os outros.
       */
      fimDaForma: new fields.ObjectField(),
      // A habilidade base vem junto do caminho e não custa XP.
      ehBase: new fields.BooleanField({ initial: false }),
      // Habilidades de caminhos que concedem recurso próprio (Energia Natural)
      // podem morar na aba daquele caminho.
      abaCaminho: new fields.BooleanField({ initial: false }),
      // Ranque (SRD §3): escopo do que a habilidade faz, e o que fixa o custo.
      ranque: num(1, { min: 1, max: 9 }),
      /*
       * Nível (SRD §3): quão bem o personagem faz aquilo. O SRD ainda não
       * fechou como ele sobe, então é editado à mão; escalaPorNivel é o texto
       * do que muda a cada nível ("+25% de dano desarmado").
       */
      nivel: num(1, { min: 1 }),
      nivelMax: num(15, { min: 1 }),
      escalaPorNivel: str(""),
      /*
       * Despertar (regra opcional, SRD §3): comprada mas ainda não recebida.
       * Só tem efeito com a regra ligada no mundo.
       */
      adormecida: new fields.BooleanField({ initial: false }),
      custoEstamina: num(0, { min: 0 }),
      custoMana: num(0, { min: 0 }),
      custoEnergia: num(0, { min: 0 }),
      /*
       * Força de Vontade como preço de ativar (SRD Atributos): ela não volta
       * com o tempo, e por isso uma habilidade que a cobra é uma habilidade
       * que se usa poucas vezes. Zero na imensa maioria delas.
       */
      custoVontade: num(0, { min: 0 }),
      // Custos em recursos de raça ({ energiaNatural: 5, ... }): as chaves
      // vêm de PYRO.recursosCustom, e a ficha só oferece as que o dono tem.
      custosCustom: new fields.ObjectField(),
      custoAcoes: num(0, { min: 0 }),
      // A habilidade gasta ações do próprio turno ou reações fora dele.
      tipoCusto: str("acao", { choices: Object.keys(PYRO.tiposCusto) }),
      formula: str(""),
      /*
       * O que o resultado da fórmula é, colado nele sem espaço nenhum: "% de
       * chance" vira "10% de chance" e " de dano" vira "10 de dano". O espaço
       * da frente é do texto, porque só quem escreve sabe se ele cabe ali — e
       * por isso o campo não apara, ao contrário do padrão do StringField.
       */
      unidadeFormula: str("", { trim: false }),
      /*
       * Sentido espiritual (perceber o mundo pela mana ou pela energia no
       * ar): a habilidade que o concede diz o tipo, o alcance por fórmula
       * ([SAB] / 2, [NVL]...) e a aparência no canvas. Tipo vazio é o caso
       * comum — habilidade nenhuma vira sentido sem pedir.
       */
      sentido: new fields.SchemaField({
        tipo: str(""),
        alcance: str(""),
        aparencia: str("azulEtereo")
      })
    };
  }

  prepareDerivedData() {
    // A curva é lida aqui, e não herdada do item de Caminho, porque os itens
    // são preparados em ordem e o Caminho pode vir depois.
    this.progressao = progressaoDoCaminho(this.parent?.actor, this.caminho);
    this.custoXp = custoDaHabilidade(this, this.progressao);
    this.adormecidaAtiva = this.adormecida && PYRO.regraAtiva("despertar");
  }
}

/* ---------------------------- Técnica ---------------------------------------- */

/**
 * Técnica (SRD Técnicas): o equivalente marcial da magia. O que ela faz sai de
 * uma ação base, de traços comprados em graus e do Esforço posto em cada traço
 * na hora de usar — nada disso é fórmula escrita à mão.
 */
export class TecnicaData extends BaseItemData {
  /** Técnicas sobem de nível pelo uso, na mesma tabela das magias. */
  static TRILHA_AVANCO = "magiaTecnica";

  static defineSchema() {
    return {
      ...super.defineSchema(),
      ranque: num(1, { min: 1, max: 9 }),
      acaoBase: str("atacar", { choices: Object.keys(PYRO.acoesBaseTecnica) }),
      /*
       * Custo próprio em ações. O que diferir das ações da arma escolhida vira
       * ponto de criação (ver PYRO.pontosDeAcoes); o teto é o turno inteiro,
       * senão uma técnica de oito ações mostraria pontos que a tabela não dá.
       */
      acoes: num(2, { min: 1, max: PYRO.ACOES_MAX_TECNICA }),
      especificidade: str("nenhuma", { choices: Object.keys(PYRO.especificidades) }),
      /*
       * Valor do filtro automático da especificidade: "distante", "media",
       * "cortante". Sem choices porque o conjunto muda com a especificidade
       * escolhida — e com os tipos de dano que o mestre configurou.
       */
      filtro: str(""),
      /*
       * Especificidade "específica": um ataque nomeado da ficha (katana, chute).
       * O nome acompanha o id como rede de segurança, igual aos alvos de efeito,
       * e as ações são o retrato de quando a arma foi escolhida — é delas que
       * sai a base da conta de pontos (ver acoesBaseDaArma em tecnica.mjs), e
       * gravá-las aqui mantém a conta fechando com a arma fora da ficha.
       */
      ataque: new fields.SchemaField({ id: str(""), nome: str(""), acoes: num(0, { min: 0 }) }),
      tracos: new fields.ArrayField(new fields.SchemaField({
        chave: str(""),
        grau: num(1, { min: 1 })
      }), { initial: [] }),
      // Pontos fracos aceitos na criação; devolvem pontos e acumulam.
      onus: new fields.ArrayField(new fields.StringField({ required: true }), { initial: [] }),
      // A forma que a técnica toma em cada postura que o usuário conhece.
      variacoes: new fields.ArrayField(new fields.SchemaField({
        posturaId: str(""),
        texto: str("")
      }), { initial: [] }),
      /*
       * A postura exigida pelo ônus "só funciona numa postura" (ver
       * PYRO.onusTecnica). Guarda id e nome, como o ataque: o id resolve na
       * ficha em que a técnica foi montada, e o nome sobrevive à técnica ser
       * copiada para outro personagem. Sem o ônus, o campo não vale nada.
       */
      postura: new fields.SchemaField({ id: str(""), nome: str("") }),
      progresso: nivelPorUso(1)
    };
  }

  prepareDerivedData() {
    this.pontos = pontosDaTecnica(this);
  }
}

/* ---------------------------- Perícia ---------------------------------------- */

/**
 * Perícia (SRD 3b): trilha separada das habilidades, treinada pelos testes.
 * Nasce no nível 0, sem bônus, e passa a valer +1 por nível (+1 vantagem a
 * cada 5) a partir do primeiro avanço.
 */
export class PericiaData extends BaseItemData {
  static TRILHA_AVANCO = "pericia";

  static defineSchema() {
    return {
      ...super.defineSchema(),
      // Atributos que a perícia aceita; o jogador escolhe um a cada teste.
      atributos: new fields.ArrayField(
        new fields.StringField({ required: true, choices: Object.keys(PYRO.atributos) }),
        { initial: ["des"] }
      ),
      // Sem as ferramentas, o ND acima de 10 dobra (acumula com o de não treinada).
      exigeFerramentas: new fields.BooleanField({ initial: false }),
      // Percepção: só rolagem bem-sucedida conta para o avanço.
      contaSoSucesso: new fields.BooleanField({ initial: false }),
      progresso: nivelPorUso(0)
    };
  }

  prepareDerivedData() {
    this.aprendida = this.progresso.nivel > 0;
  }
}

/* ---------------------------- Feitiço --------------------------------------- */

/** Magia demoníaca (Humano Feiticeiro). Sem regra no SRD ainda; só custo e fórmula até lá. */
export class FeiticoData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      custoAcoes: num(0, { min: 0 }),
      formula: str("")
    };
  }
}

/* ---------------------------- Runa ------------------------------------------ */

export class RunaData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      tipoRuna: str("elemento", { choices: Object.keys(PYRO.tiposRuna) }),
      // Subtipo depende do tipoRuna; a ficha filtra as opções (e as afinidades
      // do mago limitam os elementos disponíveis).
      subtipo: str("fogo"),
      // A palavra/gesto em si ("Chamas", "Brasa").
      palavra: str(""),
      lingua: str("humana"), // línguas são configuráveis pelo mestre
      // Subjulgar: a rolagem compara com a vida do alvo, sem dano direto.
      // Nasce ligado no elemento Morte; magias de morte utilitárias desligam.
      subjulgar: new fields.BooleanField({ initial: false }),
      // Gestos ocupam mãos; a frase inteira não pode passar das mãos livres.
      maos: num(1, { min: 0 }),
      // Tipo de dano sobreposto: vazio usa o padrão do elemento (SRD permite
      // trocar para tipos físicos via gestos).
      tipoDano: str(""),
      /*
       * O que esta runa produz por Intenção:
       *   valor = floor(base + porIntencao x (Intenção - 1))
       * faces > 0 rola (valor)d(faces); faces 0 é um número plano (metros,
       * alvos, rodadas). Nasce preenchido pelas regras do elemento/gesto e
       * fica editável aqui — as magias montadas leem daqui.
       */
      scalings: new fields.ArrayField(new fields.SchemaField({
        nome: new fields.StringField({ required: true, initial: "" }),
        base: dec(0),
        porIntencao: dec(0),
        faces: num(0, { min: 0 })
      }), { initial: [] })
    };
  }

  /** Elementos são verbais; formas e modificadores são gestos (somáticos). */
  get somatica() {
    return this.tipoRuna !== "elemento";
  }
}

/* ---------------------------- Magia (grimório) ------------------------------- */

/**
 * Uma frase rúnica salva. As Intenções são escolhidas a cada conjuração; os
 * escalonamentos entram como uma CÓPIA dos da runa no momento de salvar, e
 * ficam editáveis aqui — esta magia pode se comportar diferente da runa solta.
 */
export class MagiaData extends BaseItemData {
  /** Magias sobem de nível pelas conjurações, na tabela de magia e técnica. */
  static TRILHA_AVANCO = "magiaTecnica";

  static defineSchema() {
    return {
      ...super.defineSchema(),
      progresso: nivelPorUso(1),
      /*
       * A magia impõe um teste de resistência? Escolhido na conjuração que a
       * salvou e editável aqui depois. Nem toda frase pede resistência, e a
       * DT no card de uma que não pede só confunde a mesa.
       */
      usaDt: new fields.BooleanField({ initial: true }),
      /*
       * Com o que o alvo resiste. A perícia é guardada pelo NOME, e não por
       * id: quem rola é o alvo, e a perícia é da ficha dele — "Vontade" na
       * magia de mente encontra a Vontade de quem foi atingido, e quem não a
       * tem rola sem treino, com o ND dobrado acima de 10, como em qualquer
       * perícia. Lista vazia é magia que só anuncia a DT.
       *
       * Mais de uma entrada é escolha de quem resiste: o vento que derruba
       * aceita Atletismo (FOR) de quem se firma e Reflexos (AGI) de quem sai
       * da frente, e a janela do teste pergunta qual vai ser.
       */
      resistencias: new fields.ArrayField(new fields.SchemaField({
        pericia: str(""),
        atributo: str("sab", { choices: Object.keys(PYRO.atributos) })
      })),
      runas: new fields.ArrayField(new fields.SchemaField({
        itemId: new fields.StringField({ required: true }),
        nome: new fields.StringField({ required: true }),
        subjulgar: new fields.BooleanField({ initial: false }),
        tipoDano: new fields.StringField({ required: true, initial: "" }),
        scalings: new fields.ArrayField(new fields.SchemaField({
          nome: new fields.StringField({ required: true, initial: "" }),
          base: dec(0),
          porIntencao: dec(0),
          faces: num(0, { min: 0 })
        }), { initial: [] })
      }))
    };
  }

  prepareDerivedData() {
    /*
     * O nome na referência é um retrato de quando a magia foi salva. Em
     * memória ele acompanha a runa atual, para renomear a runa refletir na
     * lista do grimório na hora; o _onUpdate da runa regrava o retrato.
     */
    const actor = this.parent?.actor;
    if (!actor) return;
    for (const ref of this.runas ?? []) {
      const runa = actor.items.get(ref.itemId);
      if (runa?.name && ref.nome !== runa.name) ref.nome = runa.name;
    }
  }
}

/* ---------------------------- Caminho ---------------------------------------- */

/**
 * Rótulo curto de um caminho, para abas e cabeçalhos: a variação (raciais)
 * ou o nome da profissão/classe, nunca o nome completo "Caminho do X".
 */
export function rotuloCurtoDoCaminho(caminho) {
  const s = caminho.system;
  const base = (s.ehRacial ? s.racaDetalhe : s.nomeCaminho)?.trim();
  return base ? game.i18n.format("PYRO.CaminhoNome", { nome: base }) : caminho.name;
}

export class CaminhoData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      // Caminho racial (raça) ou de profissão/classe.
      ehRacial: new fields.BooleanField({ initial: false }),
      // Nome livre da profissão/classe; vira "Caminho do <nome>".
      nomeCaminho: str(""),
      // Só relevantes em caminhos raciais:
      raca: str("humano"), // lista de raças é configurável pelo mestre
      racaDetalhe: str(""), // especialização escrita ("elfo (...)", "Outro"...)
      // Qualquer caminho (racial ou de classe) pode conceder magia/feitiçaria.
      usaMagia: new fields.BooleanField({ initial: false }),
      usaFeiticaria: new fields.BooleanField({ initial: false }),
      // Potencial mágico: mesma escala das línguas rúnicas (humana, élfica...).
      potencial: str("humana"),
      // Recursos personalizados concedidos por este caminho (Energia Natural etc).
      recursos: new fields.ArrayField(new fields.StringField({ required: true }), { initial: [] }),
      /*
       * Como cada recurso concedido é calculado nesta ficha: a fórmula do
       * máximo (herdada da configuração do mundo enquanto ninguém a reescreve)
       * e a habilidade de onde sai o [NVL] dela — é assim que a Energia Natural
       * de um elfo cresce junto com a habilidade que a usa.
       */
      recursosConfig: new fields.ArrayField(new fields.SchemaField({
        chave: str(""),
        formula: str(""),
        habilidadeId: str("")
      }), { initial: [] }),
      // Afinidades elementais do mago: lista de opções, "outro" com texto livre.
      afinidades: new fields.ArrayField(new fields.SchemaField({
        // Sem choices: as afinidades derivam dos elementos, que o mestre edita
        // nas configurações do mundo (validar aqui travaria chaves novas).
        tipo: new fields.StringField({ required: true, initial: "fogo" }),
        outro: new fields.StringField({ required: true, initial: "" })
      }), { initial: [] }),
      // O tamanho vem da raça; só o primeiro caminho racial do ator define.
      tamanho: str("medio", { choices: Object.keys(PYRO.tamanhos) }),
      /*
       * Massivo e colossal não são um tamanho só: são faixas. O número diz
       * quantos espaços a criatura ocupa de fato (massivo 8–15, colossal 16+),
       * e é ele que vira o alcance dela. Zero nos outros tamanhos, que são
       * fechados e não têm o que perguntar.
       */
      tamanhoExato: num(0, { min: 0 }),
      xp: num(0, { min: 0 })
    };
  }

  prepareDerivedData() {
    /*
     * Em raça fechada o preset manda nos recursos, como já manda em magia e
     * feitiçaria: não há checkbox para o jogador decidir. Raça aberta e
     * caminho de classe seguem com o que está gravado.
     */
    if (this.ehRacial) {
      const preset = PYRO.racas?.[this.raca];
      if (preset && !preset.custom) this.recursos = [...(preset.recursos ?? [])];
    }

    const actor = this.parent?.actor;
    const habilidades = actor?.items.filter(i =>
      i.type === "habilidade" && i.system.caminho === this.parent.id
    ) ?? [];
    /*
     * XP gasta recalcula o custo de cada habilidade em vez de ler o custoXp
     * derivado dela: os itens são preparados em ordem, e um caminho preparado
     * antes das habilidades dele veria o custo ainda não calculado.
     */
    this.progressao = progressaoDoCaminho(actor, this.parent.id);
    this.xpGasta = habilidades.reduce(
      (t, i) => t + custoDaHabilidade(i.system, this.progressao), 0);
    this.xpDisponivel = this.xp - this.xpGasta;
    // Quanto custa cada ranque neste Caminho, para a ficha mostrar a curva.
    this.custosPorRanque = Object.keys(PYRO.ranques).map(ranque => ({
      ranque: Number(ranque),
      custo: PYRO.custoDoRanque(ranque, this.progressao.multiplicador)
    }));
  }
}
