<?php
declare(strict_types=1);

namespace Acme\Api\Model;

class VirtualConsumer
{
    public function __construct(private readonly \Acme\Core\Api\RepoInterface $repo)
    {
    }

    public function execute(): string
    {
        return $this->repo->save("virtual");
    }
}
