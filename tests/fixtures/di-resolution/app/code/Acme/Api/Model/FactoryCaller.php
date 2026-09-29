<?php
declare(strict_types=1);

namespace Acme\Api\Model;

class FactoryCaller
{
    public function __construct(private readonly \Acme\Core\Model\RepoFactory $repoFactory)
    {
    }

    public function execute(): string
    {
        $repo = $this->repoFactory->create();
        return $repo->save('via-factory');
    }
}
